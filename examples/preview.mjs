#!/usr/bin/env node
/**
 * A local preview of a widget as Telegram draws it: in a message bubble with a caption,
 * light and dark, at two phone widths. A stand-in TelegramWidget gives it its state, events,
 * haptics and per-message storage, and enforces the rules that bite: request(), copyText()
 * and the link calls once per tap, one request in flight. Each bubble's tag counts nodes,
 * CSS rules, @keyframes and heavy elements against the sandbox caps (a browser enforces none).
 *
 * The four examples (quiz, weather, checkout, achievement) open with sample data, answer like
 * bot.mjs (logic.mjs runs in the page), and get buttons on top that switch every bubble to a
 * named state. Any other widget gets an echo: request(d) answers {"echo":d}.
 *
 *   node preview.mjs widget.html ['<chat_data>'] [out.html] [flags]
 *     --public='<json>'   public_data (a shared widget)
 *     --state=<name>      open in a named state (one of the buttons)
 *     --readonly          no viewer: requests reject with NOT_ALLOWED (sent without allow_queries)
 *     --preview           isPreview: an inline-mode preview, no requests
 *   then open out.html (default widget-preview.html) in a browser.
 */
import fs from "node:fs";
import path from "node:path";

const flags = {}, rest = [];
for (const arg of process.argv.slice(2)) {
  const flag = /^--([\w-]+)(?:=([\s\S]*))?$/.exec(arg);
  if (flag) flags[flag[1]] = flag[2] ?? true; else rest.push(arg);
}
if (rest.length === 2 && rest[1].endsWith(".html")) rest.splice(1, 0, "");   // preview.mjs widget.html out.html
const [file, chatData, out = "widget-preview.html"] = rest;
if (!file) { console.error("usage: node preview.mjs widget.html ['<chat_data>'] [out.html] [--public='<json>'] [--state=<name>] [--readonly] [--preview]"); process.exit(2); }
const html = fs.readFileSync(file, "utf8");
const kind = path.basename(file, ".html");
const logic = fs.readFileSync(new URL("./logic.mjs", import.meta.url), "utf8").replace(/^export /gm, "");

const THEMES = {
  light: { page: "#c9dcb4", vars: { bg: "#ffffff", text: "#000000", hint: "#707579", link: "#3390ec", button: "#3390ec", "button-text": "#ffffff", "secondary-bg": "#f1f1f4", "section-separator": "#e3e3e8", "destructive-text": "#e53935", "accent-text": "#3390ec", "subtitle-text": "#707579" } },
  dark: { page: "#0e1621", vars: { bg: "#182533", text: "#ffffff", hint: "#7d8b99", link: "#6ab3f3", button: "#5288c1", "button-text": "#ffffff", "secondary-bg": "#22303f", "section-separator": "#2b3a4a", "destructive-text": "#ec5b56", "accent-text": "#6ab3f3", "subtitle-text": "#7d8b99" } }
};

// Named states per example, built in the page from logic.mjs. Each gives chat (and pub) data;
// live: the weather's clock runs. Captions are what bot.mjs sends with each.
const STATES = `{
 weather:{
  live:()=>({pub:forecast(0,now()),chat:{i:0},live:1}),
  'night rain':()=>({pub:forecast(0,now()),chat:{i:1},live:1}),
  snow:()=>({pub:forecast(0,now()),chat:{i:2},live:1}),
  dusk:()=>({pub:forecast(300,now()),chat:{i:0},live:1}),
  stale:()=>({pub:forecast(0,now()-3*3600),chat:{i:0}}),
  empty:()=>({})},
 checkout:{
  cart:()=>({chat:SAMPLE.checkout}),
  waiting:()=>({chat:checkoutStep(SAMPLE.checkout,'p210c1').state}),
  paid:()=>({chat:checkoutPaid(checkoutStep(SAMPLE.checkout,'p210c1').state,'stxDemo4mXk2Qp9Vb7Ls1Zr8Tn3Hw6Yc0Ge5Uf')}),
  failed:()=>({chat:checkoutFailed(SAMPLE.checkout,'x')}),
  empty:()=>({})},
 achievement:{
  locked:()=>({chat:ach()}),
  unlocked:()=>({chat:ach({u:1,v:5})}),
  claimed:()=>({chat:ach({u:1,v:5,c:1})}),
  gold:()=>({chat:ach({u:1,v:5,h:44,g:0,n:'Gold Streak',d:'Thirty days of practice without a break'})}),
  empty:()=>({})},
 quiz:{
  start:()=>({chat:SAMPLE.quiz}),
  done:()=>({chat:quizStep(SAMPLE.quiz,'q011020')})}
}`;
const CAPTIONS = {
  weather: "Lisbon now: 27°, partly cloudy, high 27°, low 15°. Tokyo and Reykjavik are a tap away.",
  checkout: "Your order: 2 × Gem pouch, 1 × Rocket boost. Total 22 ⭐.",
  achievement: "Night Owl: study after midnight five nights in a row. You are at 4 of 5.",
  quiz: "Three words to review: tap the meaning of each."
};

// Runs inside each bubble, before the widget: the stand-in TelegramWidget.
function stub(cfg) {
  var chat = cfg.chat, pub = cfg.pub, handlers = {}, tap = 0, busy = 0, clock = 0, watching = 0, store = {};
  var J = JSON.stringify, P = function (s) { try { return JSON.parse(s); } catch (e) { return null; } };
  function fire(name) { (handlers[name] || []).forEach(function (f) { f.call(W); }); }
  function setChat(s) { W.chatData = chat = s; fire("chatDataChanged"); }
  // In Telegram each message has its own storage; the sandboxed frame has none, so give it one (4 KB per area).
  ["localStorage", "sessionStorage"].forEach(function (name) {
    var o = {}, area = {
      getItem: function (k) { return k in o ? o[k] : null; },
      setItem: function (k, v) { var n = Object.assign({}, o); n[k] = String(v); if (J(n).length > 4096) throw new DOMException("4 KB", "QuotaExceededError"); o = n; },
      removeItem: function (k) { delete o[k]; }, clear: function () { o = {}; }, key: function (i) { return Object.keys(o)[i] || null; }
    };
    store[name] = area;
    Object.defineProperty(window, name, { value: area, configurable: true });
  });
  // One tap unlocks one call of request / copyText / openLink / openTelegramLink, for the rest of its task.
  document.addEventListener("click", function () { tap = 1; setTimeout(function () { tap = 0; }); }, true);
  function spend(what) { if (tap) { tap = 0; return true; } console.warn(what + ": not inside a tap, ignored"); return false; }
  // The bot: [answer, new chat_data or undefined], as bot.mjs does it.
  function answer(d) {
    var s = P(chat);
    if (!s || !cfg.kind) return [J({ echo: d })];
    if (cfg.kind === "quiz") s = quizStep(s, d);
    else if (cfg.kind === "achievement") s = achievementStep(s, d);
    else if (cfg.kind === "checkout") {
      var r = checkoutStep(s, d);
      if (r.error) return [J({ e: r.error })];
      if (r.effect === "invoice") setTimeout(function () {   // the user pays the invoice below
        var now = P(chat);
        if (now && now.s === "w") setChat(J(checkoutPaid(now, "stxDemo" + Date.now().toString(36))));
      }, 2500);
      s = r.state;
    } else return [J({ echo: d })];
    return [J(s), J(s)];
  }
  var W = window.TelegramWidget = {
    chatData: chat, publicData: pub, colorScheme: cfg.scheme, themeParams: Object.freeze(cfg.params), profile: 1,
    isActive: true, isPreview: !!cfg.preview, isForward: false, chatType: "private", wallet: null,
    viewer: cfg.readonly || cfg.preview ? null : { id: 1, first_name: "Alex", username: "alex" },
    contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0, cornerLeft: 0, cornerRight: 0 },
    onEvent: function (n, f) { (handlers[n] = handlers[n] || []).push(f); },
    offEvent: function (n, f) { handlers[n] = (handlers[n] || []).filter(function (g) { return g !== f; }); },
    ready: function () {}, setResizeAnchor: function () {}, isProfileAtLeast: function (p) { return p <= 1; },
    watchPublicData: function () {
      if (watching || !cfg.live || cfg.kind !== "weather") return; watching = 1;
      setInterval(function () { clock += 20; W.publicData = pub = J(forecast(clock, Math.floor(Date.now() / 1000))); fire("publicDataChanged"); }, 3000);
    },
    unwatchPublicData: function () {},
    HapticFeedback: { notificationOccurred: function () { return this; }, impactOccurred: function () { return this; }, selectionChanged: function () { return this; } },
    copyText: function (t) { if (spend("copyText")) console.log("copyText", t); },
    openLink: function (u) { if (spend("openLink")) console.log("openLink", u); },
    openTelegramLink: function (u) { if (spend("openTelegramLink")) console.log("openTelegramLink", u); },
    request: function (d) {
      var err = function (code) { var e = new Error(code); e.name = "WidgetRequestError"; e.code = code; return Promise.reject(e); };
      if (typeof d !== "string" || !d || new TextEncoder().encode(d).length > 64) throw new TypeError("request data: 1–64 bytes");
      if (!W.viewer || !spend("request")) return err("NOT_ALLOWED");
      if (busy) return err("BUSY");
      busy = 1;
      return new Promise(function (ok) {
        setTimeout(function () { var a = answer(d); busy = 0; if (a[1] !== undefined) setChat(a[1]); ok({ result: a[0] }); }, 400);
      });
    }
  };
  // Height and the caps meter, sent to the page.
  function heavy(el) {
    var s = getComputedStyle(el);
    if (+s.opacity < 1 || s.filter !== "none" || (s.backdropFilter || "none") !== "none") return 1;
    return s.boxShadow.split(/,(?![^(]*\))/).some(function (one) { var n = one.match(/-?[\d.]+px/g) || []; return parseFloat(n[2]) > 0; }) ? 1 : 0;
  }
  function rules(list, c) {
    for (var i = 0; i < list.length; i++) { var r = list[i]; if (r.type === 7) c.k++; else if (r.type === 4 || r.type === 12) rules(r.cssRules, c); else c.r++; }
    return c;
  }
  var last = "";
  function report(full) {
    if (!document.body) return;
    var b = document.body, msg = { h: Math.ceil(b.getBoundingClientRect().bottom + parseFloat(getComputedStyle(b).marginBottom)) };
    if (full) {
      var all = b.getElementsByTagName("*"), c = { r: 0, k: 0 }, hv = 0;
      for (var i = 0; i < all.length; i++) hv += heavy(all[i]);
      [].forEach.call(document.styleSheets, function (sh) { if (sh.ownerNode.id !== "tg-stub") rules(sh.cssRules, c); });
      msg.n = all.length; msg.hv = hv; msg.r = c.r; msg.k = c.k;
    }
    var key = J(msg);
    if (key !== last) { last = key; parent.postMessage(msg, "*"); }
  }
  setInterval(report, 150);
  setInterval(function () { report(1); }, 2000);
  setTimeout(function () { report(1); }, 300);
}

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Widget preview: ${kind}</title><style>
body{margin:0;padding:16px;font:14px system-ui,sans-serif;background:#f5f5f7}.row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start}
.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:12px}.bar b{margin-right:6px}
.bar button{font:inherit;border:1px solid #ccd;border-radius:8px;background:#fff;padding:4px 10px;cursor:pointer}.bar button.on{background:#222;color:#fff;border-color:#222}
.cell{padding:14px 12px 16px;border-radius:14px}.tag{font-size:11px;color:rgba(0,0,0,.55);margin-bottom:8px;background:rgba(255,255,255,.7);display:inline-block;padding:1px 6px;border-radius:6px}
.tag span{display:block}.tag i{font-style:normal;color:#c00;font-weight:700}
.bubble{border-radius:16px 16px 16px 4px;overflow:hidden;transform:translateZ(0)}iframe{display:block;width:100%;border:0}
.cap{padding:2px 12px 7px;font-size:15px;line-height:1.3}.time{float:right;font-size:12px;margin:6px 0 0 10px}
</style></head><body><div class="bar" id="bar"></div><div class="row" id="row"></div>
<script>
${logic}
const now=()=>Math.floor(Date.now()/1000),
 ach=(x)=>({...SAMPLE.achievement,k:'https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fexample_bot%3Fstart%3Dowl&text=I%20just%20unlocked%20Night%20Owl',...x}),
 HTML=${JSON.stringify(html).replace(/</g, "\\u003c")},KIND=${JSON.stringify(kind)},
 STATES=(${STATES})[KIND]||{},THEMES=${JSON.stringify(THEMES)},
 CAPTION=${JSON.stringify(CAPTIONS[kind] || "Caption")},
 GIVEN={chat:${JSON.stringify(chatData || null)},pub:${JSON.stringify(flags.public ?? null)}},
 FLAGS=${JSON.stringify({ readonly: !!flags.readonly, preview: !!flags.preview })},
 LOGIC=${JSON.stringify(logic).replace(/</g, "\\u003c")},STUB=${JSON.stringify("(" + stub + ")").replace(/</g, "\\u003c")};
const str=(v)=>v==null?null:typeof v==='string'?v:JSON.stringify(v);
const CAPS={n:2000,r:400,k:32,hv:16};
function mount(name){
 const st=name&&STATES[name]?STATES[name]():GIVEN.chat!=null||GIVEN.pub!=null||!Object.keys(STATES).length?GIVEN:STATES[Object.keys(STATES)[0]]();
 document.querySelectorAll('.bar button').forEach(b=>b.className=b.textContent===name?'on':'');
 const row=document.getElementById('row');row.textContent='';
 for(const scheme of ['light','dark'])for(const width of [270,330]){
  const t=THEMES[scheme],vars=Object.entries(t.vars).map(([n,v])=>'--tg-theme-'+n+'-color:'+v).join(';'),
   params=Object.fromEntries(Object.entries(t.vars).map(([n,v])=>[n.replace(/-/g,'_')+'_color',v])),
   cfg={kind:Object.keys(STATES).length?KIND:'',scheme,params,chat:str(st.chat),pub:str(st.pub),live:!!st.live,...FLAGS};
  const cell=document.createElement('div');cell.className='cell';cell.style.background=t.page;
  cell.innerHTML='<div class="tag" style="max-width:'+(width-12)+'px">'+scheme+' · '+width+'px <span></span></div><div class="bubble" style="width:'+width+'px;background:'+t.vars.bg+'"><iframe sandbox="allow-scripts" style="height:120px"></iframe><div class="cap" style="color:'+t.vars.text+'"><span class="time" style="color:'+t.vars.hint+'">19:30</span></div></div>';
  cell.querySelector('.cap').prepend(CAPTION);
  cell.querySelector('iframe').srcdoc='<!doctype html><html><head><meta charset="utf-8"><style id="tg-stub">:root{'+vars+';color-scheme:'+scheme+'}'+
   'html{background:var(--tg-theme-bg-color)}body{background:transparent;color:var(--tg-theme-text-color);font:15px/1.35 system-ui,sans-serif;margin:8px 12px}'+
   'button{font:inherit;cursor:pointer}</style><scr'+'ipt>(function(){'+LOGIC+';'+STUB+'('+JSON.stringify(cfg)+')})()</scr'+'ipt></head><body>'+HTML+'</body></html>';
  row.appendChild(cell);
 }
}
addEventListener('message',(e)=>{document.querySelectorAll('iframe').forEach((f)=>{if(f.contentWindow!==e.source)return;
 if(e.data.h)f.style.height=e.data.h+'px';
 if(e.data.n!=null){const m=['nodes '+e.data.n,'rules '+e.data.r,'keyframes '+e.data.k,'heavy '+e.data.hv,'height '+e.data.h].map((s,i)=>{const k=['n','r','k','hv'][i];return k&&e.data[k]>CAPS[k]?'<i>'+s+'</i>':s});
  f.closest('.cell').querySelector('.tag span').innerHTML=m.join(' · ')}})});
const bar=document.getElementById('bar');
if(Object.keys(STATES).length){bar.innerHTML='<b>'+KIND+'</b>';for(const n of Object.keys(STATES)){const b=document.createElement('button');b.textContent=n;b.onclick=()=>mount(n);bar.appendChild(b)}}
mount(${JSON.stringify(typeof flags.state === "string" ? flags.state : "")});
</script></body></html>`;
fs.writeFileSync(out, page);
console.log(out);
