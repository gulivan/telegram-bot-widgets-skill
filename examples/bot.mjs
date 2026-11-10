#!/usr/bin/env node
/**
 * A minimal bot (Node 18+, no dependencies) for the four example widgets.
 * Long polling; state in memory (use a database with a row lock per message in production).
 * What each request does to the state is in logic.mjs, shared with preview.mjs.
 *
 *   TELEGRAM_BOT_TOKEN=… node bot.mjs
 *   then, in a private chat with the bot:
 *     /quiz              three questions; the bot records each answer
 *     /weather [city]    a shared widget: one edit moves every message that shows it
 *                        (a demo day runs for 30 minutes, 20 minutes of sky every 10 s)
 *     /checkout          a cart paid with Telegram Stars. Real Stars: the bot refunds every
 *                        payment 10 s later (KEEP_STARS=1 keeps them)
 *     /achievement       a badge that unlocks live, with claim and share
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SAMPLE, quizStep, checkoutStep, checkoutPaid, checkoutFailed, achievementStep, forecast } from "./logic.mjs";

const token = process.env.TELEGRAM_BOT_TOKEN || "";
if (!/^\d+:[\w-]+$/.test(token)) { console.error("set TELEGRAM_BOT_TOKEN"); process.exit(1); }
// Load every widget now: a missing file must stop the bot at start, not at the first command.
const dir = path.dirname(fileURLToPath(import.meta.url));
const html = Object.fromEntries(["quiz", "weather", "checkout", "achievement"].map((name) => [name, fs.readFileSync(path.join(dir, name + ".html"), "utf8")]));

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return res.json();
}

const me = (await api("getMe").catch(() => ({}))).result;
if (!me) { console.error("getMe failed: check TELEGRAM_BOT_TOKEN and the network"); process.exit(1); }
const say = (chat_id, text) => api("sendMessage", { chat_id, text });

// (chat id:message id) → { kind, chat, message, user, state, …private }: the bot's own record, the only one it trusts.
// `state` is exactly what the message's chat_data holds.
const widgets = new Map();

async function send(kind, chat, state, caption, extra = {}) {
  const sent = await api("sendWidget", { chat_id: chat, html: html[kind], caption, chat_data: JSON.stringify(state), ...extra });
  if (!sent.ok) { await say(chat, caption); return null; }   // never lose the message
  const record = { kind, chat, message: sent.result.message_id, user: chat, state };
  widgets.set(`${chat}:${record.message}`, record);
  return record;
}
// The state every device sees; "message is not modified" just means it already has it.
const edit = (record) => api("editMessageWidgetData", { chat_id: record.chat, message_id: record.message, chat_data: JSON.stringify(record.state) });
// Every request ends here: the widget gets the new state at once, then every device by the edit.
async function publish(query, record) {
  await api("answerWidgetQuery", { widget_query_id: query.id, data: JSON.stringify(record.state) });
  await edit(record);
}

async function onWidgetQuery(query) {
  const record = widgets.get(`${query.chat?.id}:${query.message_id}`);
  if (!record || record.user !== query.from.id) {
    await api("answerWidgetQuery", { widget_query_id: query.id }); // answer every query, even refused ones
    return;
  }
  if (record.kind === "quiz") {
    record.state = quizStep(record.state, query.data);
    await publish(query, record);
    if (record.state.r.length === record.state.q.length) console.log(`quiz done: ${record.state.r.filter(Boolean).length}/${record.state.q.length}`);
  } else if (record.kind === "achievement") {
    const was = record.state.u;
    record.state = achievementStep(record.state, query.data);
    await publish(query, record);
    if (!was && record.state.u) console.log(`badge unlocked: ${record.state.n}`);
  } else if (record.kind === "checkout") {
    await onCheckout(query, record);
  } else {
    await api("answerWidgetQuery", { widget_query_id: query.id });
  }
}

// ── Checkout: the widget sends the whole cart at Pay; the bot recounts it, sends a Stars invoice,
// and the widget turns paid when the payment arrives. Payload "<chat>:<message>:<attempt>":
// a new invoice or "Change the order" raises the attempt, so an older invoice can't be paid.
let orderNumber = 1041;
async function onCheckout(query, record) {
  const { state, effect, error } = checkoutStep(record.state, query.data);
  if (error) {
    await api("answerWidgetQuery", { widget_query_id: query.id, data: JSON.stringify({ e: error }) });
    return;
  }
  if (effect === "invoice") {
    // Sent before the answer: the widget must not say "invoice sent" when none was.
    const attempt = record.attempt + 1;
    const sent = await api("sendInvoice", {
      chat_id: record.chat, title: `Order #${state.o}`,
      description: state.i.filter((x) => x.q).map((x) => `${x.q} × ${x.n}`).join(", "),
      payload: `${record.chat}:${record.message}:${attempt}`,
      provider_token: "", currency: "XTR",
      prices: [{ label: "Total", amount: state.t }]   // exactly one item for Stars
    });
    if (!sent.ok) {
      console.error("sendInvoice failed:", sent.description);
      await api("answerWidgetQuery", { widget_query_id: query.id, data: JSON.stringify({ e: "d" }) });
      return;
    }
    if (record.invoice) await api("deleteMessage", { chat_id: record.chat, message_id: record.invoice });
    clearTimeout(record.timer);
    Object.assign(record, { attempt, invoice: sent.result.message_id, timer: setTimeout(() => expire(record), 10 * 60e3) });
  } else if (effect === "cancel") {
    clearTimeout(record.timer);
    if (record.invoice) await api("deleteMessage", { chat_id: record.chat, message_id: record.invoice });
    Object.assign(record, { attempt: record.attempt + 1, invoice: null, timer: null });
  }
  record.state = state;
  await publish(query, record);
}
async function expire(record) {
  if (record.state.s !== "w") return;
  if (record.invoice) await api("deleteMessage", { chat_id: record.chat, message_id: record.invoice });
  Object.assign(record, { attempt: record.attempt + 1, invoice: null, timer: null, state: checkoutFailed(record.state, "x") });
  await edit(record);
}
const byPayload = (payload) => {
  const [chat, message, attempt] = String(payload).split(":");
  return { record: widgets.get(`${chat}:${message}`), attempt: +attempt };
};
// Answer within 10 s. Only the latest invoice of a waiting order, for its total, from its owner.
async function onPreCheckout(query) {
  const { record, attempt } = byPayload(query.invoice_payload);
  const ok = record?.kind === "checkout" && record.state.s === "w" && attempt === record.attempt &&
    query.total_amount === record.state.t && query.currency === "XTR" && query.from.id === record.user;
  await api("answerPreCheckoutQuery", ok ? { pre_checkout_query_id: query.id, ok } :
    { pre_checkout_query_id: query.id, ok, error_message: "This order has changed. Open the cart and pay again." });
}
async function onPaid(message) {
  const payment = message.successful_payment, { record } = byPayload(payment.invoice_payload);
  console.log(`paid: ${payment.total_amount} Stars, order ${record ? "#" + record.state.o : "unknown"}`);
  if (record) {
    clearTimeout(record.timer);
    Object.assign(record, { invoice: null, timer: null, state: checkoutPaid(record.state, payment.telegram_payment_charge_id) });
    await edit(record);
  }
  if (process.env.KEEP_STARS === "1") return;
  // A demo shop keeps nothing: the Stars go back; the widget stays paid.
  setTimeout(async () => {
    const refund = await api("refundStarPayment", { user_id: message.from.id, telegram_payment_charge_id: payment.telegram_payment_charge_id }).catch(() => ({}));
    if (refund.ok) await say(message.chat.id, `This is a demo: your ${payment.total_amount} ⭐ were refunded.`);
    else console.error("refund failed:", refund.description);
  }, 10e3);
}
async function sendCheckout(chat) {
  const state = { ...SAMPLE.checkout, o: ++orderNumber };
  const items = state.i.filter((x) => x.q).map((x) => `${x.q} × ${x.n}`).join(", ");
  const record = await send("checkout", chat, state, `Your order: ${items}. Total ${state.t} ⭐. Open it to change or pay.`, { allow_queries: true });
  if (record) Object.assign(record, { attempt: 0, invoice: null, timer: null });
}

// ── Weather: one shared widget for everyone. public_data holds every city; each message's
// chat_data {"i":n} picks the city it opens on. While someone asked in the last 30 minutes,
// the demo clock moves 20 minutes every 10 s and one edit updates every message.
const SKIES = ["clear", "partly cloudy", "cloudy", "rain", "a thunderstorm", "snow", "fog"];
const weather = { id: null, clock: 0, until: 0, timer: null, statics: [] };
const now = () => Math.floor(Date.now() / 1000);
async function sendWeather(chat, name) {
  const data = forecast(weather.clock, now()), cities = data.c;
  const i = Math.max(0, cities.findIndex((c) => c.n.toLowerCase() === String(name).toLowerCase()));
  const c = cities[i], others = cities.filter((_, k) => k !== i).map((x) => x.n).join(" and ");
  const caption = `${c.n} now: ${c.t}°, ${SKIES[c.k]}, high ${c.h}°, low ${c.l}°. ${others} are a tap away.`;
  const chat_data = JSON.stringify({ i });
  let sent = weather.id
    ? await api("sendSharedWidget", { chat_id: chat, widget_id: weather.id, chat_data, caption })
    : await api("sendWidget", { chat_id: chat, html: html.weather, is_shared: true, public_data: JSON.stringify(data), chat_data, caption });
  if (sent.ok && !weather.id) weather.id = sent.result.widget?.id || null;
  if (!sent.ok) {
    // Shared refused: a static widget with the whole forecast in chat_data; the same HTML reads either.
    const state = { ...data, i };
    sent = await api("sendWidget", { chat_id: chat, html: html.weather, chat_data: JSON.stringify(state), caption });
    if (!sent.ok) { await say(chat, caption); return; }
    weather.statics = [...weather.statics, { chat, message: sent.result.message_id, i }].slice(-20);
  }
  weather.until = Date.now() + 30 * 60e3;
  weather.timer ??= setInterval(tick, 10e3);
}
async function tick() {
  if (Date.now() > weather.until) { clearInterval(weather.timer); weather.timer = null; return; }   // never call the API forever
  weather.clock += 20;
  const data = forecast(weather.clock, now());
  if (weather.id) await api("editSharedWidgetData", { widget_id: weather.id, public_data: JSON.stringify(data), cache_time: 10 }).catch(() => {});
  for (const s of weather.statics) await api("editMessageWidgetData", { chat_id: s.chat, message_id: s.message, chat_data: JSON.stringify({ ...data, i: s.i }) }).catch(() => {});
}

// ── Achievement: "Check in today" stands in for real activity. A real bot edits chat_data when
// the user earns the badge, and an open widget plays the unlock.
async function sendAchievement(chat) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${me.username}?start=owl`)}&text=${encodeURIComponent("I just unlocked Night Owl")}`;
  const state = { ...SAMPLE.achievement, ...(share.length <= 256 ? { k: share } : {}) };
  await send("achievement", chat, state, `Night Owl: study after midnight five nights in a row. You are at ${state.v} of ${state.m}.`, { allow_queries: true });
}

const HELP = "Widget examples: /quiz, /weather, /checkout, /achievement.";
async function onMessage(message) {
  if (message.successful_payment) return onPaid(message);
  if (message.chat.type !== "private" || !message.text) return;
  const [command, arg = ""] = message.text.split(/\s+/), name = command.replace(/@\w+$/, ""), chat = message.chat.id;
  if (name === "/quiz") await send("quiz", chat, SAMPLE.quiz, "Three words to review: tap the meaning of each.", { allow_queries: true });
  else if (name === "/weather") await sendWeather(chat, arg);
  else if (name === "/checkout") await sendCheckout(chat);
  else if (name === "/achievement") await sendAchievement(chat);
  else if (name === "/paysupport") await say(chat, "This is an example bot: every payment is refunded automatically.");
  else if (name === "/start" && arg === "owl") await say(chat, "Night Owl is a badge from this bot. Send /achievement to earn yours.");
  else if (name === "/start") await say(chat, HELP);
}

let offset = 0;
console.log(`@${me.username} is running. ${HELP}`);
for (;;) {
  const updates = await api("getUpdates", {
    offset, timeout: 30, allowed_updates: ["message", "widget_query", "shared_widget_query", "pre_checkout_query"]
  }).catch(() => ({ ok: false }));
  if (!updates.ok) { await new Promise((done) => setTimeout(done, 2000)); continue; }
  for (const update of updates.result) {
    offset = update.update_id + 1;
    try {
      if (update.message) await onMessage(update.message);
      else if (update.widget_query) await onWidgetQuery(update.widget_query);
      else if (update.shared_widget_query) await api("answerWidgetQuery", { widget_query_id: update.shared_widget_query.id });
      else if (update.pre_checkout_query) await onPreCheckout(update.pre_checkout_query);
    } catch (err) {
      console.error("update failed:", err.message);
    }
  }
}
