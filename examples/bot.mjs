#!/usr/bin/env node
/**
 * A minimal bot (Node 18+, no dependencies) that sends the quiz widget and
 * records its answers. Long polling; state in memory (use a database with a
 * row lock per message in production).
 *
 *   TELEGRAM_BOT_TOKEN=… node bot.mjs
 *   then write /quiz to the bot in a private chat.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.TELEGRAM_BOT_TOKEN || "";
if (!/^\d+:[\w-]+$/.test(token)) { console.error("set TELEGRAM_BOT_TOKEN"); process.exit(1); }
const html = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "quiz.html"), "utf8");

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return res.json();
}

const QUESTIONS = [
  { h: "你好", p: "nǐ hǎo", o: ["thank you", "hello", "goodbye"], a: 1 },
  { h: "谢谢", p: "xièxie", o: ["thank you", "sorry", "please"], a: 0 },
  { h: "再见", p: "zàijiàn", o: ["welcome", "good night", "goodbye"], a: 2 }
];

// (chat id:message id) → { user, q, r }: the bot's own record, the only one it trusts.
const widgets = new Map();

async function sendQuiz(chatId) {
  const caption = "Three words to review: tap the meaning of each.";
  const sent = await api("sendWidget", {
    chat_id: chatId, html, caption, allow_queries: true,
    chat_data: JSON.stringify({ q: QUESTIONS })
  });
  if (!sent.ok) { await api("sendMessage", { chat_id: chatId, text: caption }); return; } // never lose the message
  widgets.set(`${chatId}:${sent.result.message_id}`, { user: chatId, q: QUESTIONS, r: [] });
}

// "q01" or "q0112": every answer the widget hasn't seen confirmed, as index + option.
const parse = (data) => /^q(?:\d\d)+$/.test(data) ? data.slice(1).match(/\d\d/g).map((p) => [+p[0], +p[1]]) : [];

async function onWidgetQuery(query) {
  const key = `${query.chat?.id}:${query.message_id}`;
  const widget = widgets.get(key);
  if (!widget || widget.user !== query.from.id) {
    await api("answerWidgetQuery", { widget_query_id: query.id }); // answer every query, even refused ones
    return;
  }
  // In order, once each: a retry carries answers already recorded, a gap stops it.
  for (const [index, option] of parse(query.data)) {
    if (index < widget.r.length) continue;
    if (index > widget.r.length || !widget.q[index] || option >= widget.q[index].o.length) break;
    widget.r.push(option === widget.q[index].a ? 1 : 0);
  }
  await api("answerWidgetQuery", { widget_query_id: query.id, data: JSON.stringify({ r: widget.r }) });
  // The state every device sees; "message is not modified" just means it already has it.
  await api("editMessageWidgetData", { chat_id: query.chat.id, message_id: query.message_id, chat_data: JSON.stringify({ q: widget.q, r: widget.r }) });
  if (widget.r.length === widget.q.length) console.log(`quiz done: ${widget.r.filter(Boolean).length}/${widget.q.length}`);
}

let offset = 0;
for (;;) {
  const updates = await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message", "widget_query", "shared_widget_query"] }).catch(() => ({ ok: false }));
  if (!updates.ok) { await new Promise((done) => setTimeout(done, 2000)); continue; }
  for (const update of updates.result) {
    offset = update.update_id + 1;
    try {
      if (update.message?.text === "/quiz" && update.message.chat.type === "private") await sendQuiz(update.message.chat.id);
      else if (update.widget_query) await onWidgetQuery(update.widget_query);
    } catch (err) {
      console.error("update failed:", err.message);
    }
  }
}
