#!/usr/bin/env node
/**
 * A local preview of a widget as Telegram draws it: in a message bubble with
 * a caption, light and dark, at two phone widths. A stand-in TelegramWidget
 * gives it chatData, events and haptics; request() echoes the data back after
 * 250 ms (replace `answer` below with your bot's logic to test the full loop).
 *
 *   node preview.mjs widget.html ['<chat_data>'] [out.html]
 *   then open out.html (default widget-preview.html) in a browser.
 */
import fs from "node:fs";

const [file, chatData = "", out = "widget-preview.html"] = process.argv.slice(2);
if (!file) { console.error("usage: node preview.mjs widget.html ['<chat_data>'] [out.html]"); process.exit(2); }
const html = fs.readFileSync(file, "utf8");

const THEMES = {
  light: { page: "#c9dcb4", vars: { bg: "#ffffff", text: "#000000", hint: "#707579", link: "#3390ec", button: "#3390ec", "button-text": "#ffffff", "secondary-bg": "#f1f1f4", "section-separator": "#e3e3e8" } },
  dark: { page: "#0e1621", vars: { bg: "#182533", text: "#ffffff", hint: "#7d8b99", link: "#6ab3f3", button: "#5288c1", "button-text": "#ffffff", "secondary-bg": "#22303f", "section-separator": "#2b3a4a" } }
};

// The stand-in. `answer(data, state)` returns [answer data, new chat state or undefined].
const stub = (scheme) => `<script>
(function(){var data=${JSON.stringify(chatData || null)},handlers={};
function answer(d,s){return [JSON.stringify({echo:d}),undefined]}
window.TelegramWidget={chatData:data,colorScheme:${JSON.stringify(scheme)},profile:1,isPreview:false,isForward:false,chatType:'private',
onEvent:function(n,f){(handlers[n]=handlers[n]||[]).push(f)},offEvent:function(){},ready:function(){},
HapticFeedback:{notificationOccurred:function(){return this},impactOccurred:function(){return this},selectionChanged:function(){return this}},
copyText:function(){},openLink:function(u){console.log('openLink',u)},openTelegramLink:function(u){console.log('openTelegramLink',u)},
request:function(d){return new Promise(function(ok){setTimeout(function(){var a=answer(d,data);
 if(a[1]!==undefined){data=a[1];window.TelegramWidget.chatData=data;(handlers.chatDataChanged||[]).forEach(function(f){f()})}
 ok({result:a[0]})},250)})}};
var last=0;setInterval(function(){var h=document.body?document.body.offsetHeight+16:0;if(h!=last){last=h;parent.postMessage({h:h},'*')}},150);
})();
</script>`;

function frame(theme, scheme) {
  const vars = Object.entries(theme.vars).map(([name, value]) => `--tg-theme-${name}-color:${value}`).join(";");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>:root{${vars};color-scheme:${scheme}}
html{background:var(--tg-theme-bg-color)}body{background:transparent;color:var(--tg-theme-text-color);font:15px/1.35 system-ui,sans-serif;margin:8px 12px}
button{font:inherit;cursor:pointer}</style>${stub(scheme)}</head><body>${html}</body></html>`;
  return `<iframe sandbox="allow-scripts" srcdoc="${doc.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" style="height:120px"></iframe>`;
}

const cells = [];
for (const scheme of ["light", "dark"]) {
  for (const width of [270, 330]) {
    const theme = THEMES[scheme];
    cells.push(`<div class="cell" style="background:${theme.page}"><div class="tag">${scheme} · ${width}px</div>
<div class="bubble" style="width:${width}px;background:${theme.vars.bg}">${frame(theme, scheme)}
<div class="cap" style="color:${theme.vars.text}">Caption<span class="time" style="color:${theme.vars.hint}">19:30</span></div></div></div>`);
  }
}

fs.writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><title>Widget preview</title><style>
body{margin:0;padding:16px;font:14px system-ui,sans-serif;background:#f5f5f7}.row{display:flex;flex-wrap:wrap;gap:12px}
.cell{padding:14px 12px 16px;border-radius:14px}.tag{font-size:11px;color:rgba(0,0,0,.5);margin-bottom:8px;background:rgba(255,255,255,.6);display:inline-block;padding:1px 6px;border-radius:6px}
.bubble{border-radius:16px 16px 16px 4px;overflow:hidden}iframe{display:block;width:100%;border:0}
.cap{padding:2px 12px 7px;font-size:15px}.time{float:right;font-size:12px;margin:6px 0 0 10px}
</style></head><body><div class="row">${cells.join("")}</div>
<script>addEventListener('message',function(e){document.querySelectorAll('iframe').forEach(function(f){if(f.contentWindow===e.source)f.style.height=e.data.h+'px'})});</script>
</body></html>`);
console.log(out);
