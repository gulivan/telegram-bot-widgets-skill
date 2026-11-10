/**
 * The bot's side of the examples as pure functions: what each request does to the state.
 * bot.mjs imports this file; preview.mjs pastes it into its page with `export ` removed,
 * so it has no imports, no side effects, and every export starts a line.
 */

// The first state of each widget, exactly as it goes into chat_data.
export const SAMPLE = {
  // quiz.html. q: questions (h prompt, p hint, o options, a the right one); r: answers recorded, 1 right / 0 wrong.
  quiz: {
    q: [
      { h: "你好", p: "nǐ hǎo", o: ["thank you", "hello", "goodbye"], a: 1 },
      { h: "谢谢", p: "xièxie", o: ["thank you", "sorry", "please"], a: 0 },
      { h: "再见", p: "zàijiàn", o: ["welcome", "good night", "goodbye"], a: 2 }
    ],
    r: []
  },
  // checkout.html. s: c cart, w waiting for payment, p paid, f failed (e: x expired, d declined, c cart changed);
  // o order number; i items (n name, e emoji, p price in Stars, q quantity 0–9); c coupon (n code, k % off, a applied);
  // t the total the bot counted; id the payment's charge id once paid.
  checkout: {
    s: "c", o: 1042, t: 22,
    i: [{ n: "Gem pouch", e: "💎", p: 5, q: 2 }, { n: "Rocket boost", e: "🚀", p: 12, q: 1 }, { n: "Paint kit", e: "🎨", p: 3, q: 0 }],
    c: { n: "STAR20", k: 20, a: 0 }
  },
  // achievement.html. u unlocked; n, d name and one line (under 45 characters); g emblem 0 star, 1 flame, 2 moon, 3 bolt;
  // h hue; v / m progress and r the words after it; x reward XP, c claimed; nx the next badge; k a share link (≤ 256).
  achievement: {
    u: 0, n: "Night Owl", d: "Study after midnight five nights in a row", g: 2, h: 262, v: 4, m: 5, r: "nights · one more to go",
    x: 50, c: 0, nx: { n: "Early Bird", g: 1, h: 20, v: 3, m: 10 }
  }
};

// Quiz: "q" + (index, option) pairs, every answer the widget hasn't seen confirmed.
// In order and once each: a retry carries answers already recorded, a gap stops it.
export function quizStep(state, data) {
  const r = [...(state.r || [])];
  for (const [index, option] of /^q(?:\d\d)+$/.test(data) ? data.slice(1).match(/\d\d/g).map((p) => [+p[0], +p[1]]) : []) {
    if (index < r.length) continue;
    if (index > r.length || !state.q[index] || option >= state.q[index].o.length) break;
    r.push(option === state.q[index].a ? 1 : 0);
  }
  return { ...state, r };
}

// Checkout: "p<quantity of each item>c<coupon 0|1>" at Pay (the whole cart, so a retry is harmless), "x" to change the order.
// Returns { state, effect?: "invoice" | "cancel", error?: code for the widget }. The total is always recounted here.
export function checkoutStep(state, data) {
  const pay = /^p(\d{1,6})c([01])$/.exec(data);
  if (pay && pay[1].length === state.i.length) {
    if (state.s === "p") return { state };                                   // paid: never a second invoice
    const q = [...pay[1]].map(Number), a = state.c ? +pay[2] : 0;
    if (state.s === "w" && q.every((n, i) => n === state.i[i].q) && a === (state.c?.a || 0)) return { state };   // the same tap again
    const sub = state.i.reduce((sum, item, i) => sum + item.p * q[i], 0);
    const t = sub - (a ? Math.round(sub * state.c.k / 100) : 0);
    if (!t) return { state, error: "c" };
    const next = { ...state, s: "w", t, i: state.i.map((item, i) => ({ ...item, q: q[i] })) };
    if (next.c) next.c = { ...next.c, a };
    delete next.e;
    return { state: next, effect: "invoice" };
  }
  if (data === "x" && state.s === "w") return { state: { ...state, s: "c" }, effect: "cancel" };
  return { state, error: "d" };
}
export function checkoutPaid(state, chargeId) { return { ...state, s: "p", id: chargeId }; }
export function checkoutFailed(state, code) { return { ...state, s: "f", e: code }; }

// Achievement: "+<v>" checks in (counted only if v is still the bot's own, so a retry never counts twice), "c" claims.
export function achievementStep(state, data) {
  if (data[0] === "+" && !state.u && +data.slice(1) === state.v) { const v = state.v + 1; return { ...state, v, u: v >= state.m ? 1 : 0 }; }
  if (data === "c" && state.u) return { ...state, c: 1 };
  return state;                                      // a retry or a stale tap: answer with what is true
}

// Weather: public_data for minute `clock` of a made-up day; `now` in unix seconds. Replace this with your weather source.
// r revision; u written at; c cities: n name, m minute of the local day, a/z sunrise/sunset minutes,
// k sky (0 clear, 1 partly cloudy, 2 cloudy, 3 rain, 4 thunderstorm, 5 snow, 6 fog), t/h/l now/high/low,
// f/w temperature and sky for this hour and the next five, x wind km/h, humidity %, UV.
export const CITIES = [
  // name, sunrise, sunset, mean °C, swing, skies (one per four hours), the minute the demo starts at, wind/humidity/UV
  ["Lisbon", 412, 1215, 21, 6, [0, 0, 1, 1, 0, 2], 870, [12, 58, 5]],
  ["Tokyo", 350, 1010, 13, 4, [2, 3, 4, 3, 2, 3], 1290, [22, 91, 0]],
  ["Reykjavik", 440, 1000, -2, 3, [5, 5, 2, 6, 6, 5], 455, [31, 80, 1]]
];
export function forecast(clock, now) {
  const temp = (base, swing, m) => Math.round(base + swing * Math.sin((m - 540) / 1440 * 2 * Math.PI)) || 0;   // warmest at 15:00
  return {
    r: clock, u: now,
    c: CITIES.map(([n, a, z, base, swing, skies, start, x]) => {
      const m = (start + clock) % 1440, hours = [0, 1, 2, 3, 4, 5].map((k) => (m + 60 * k) % 1440);
      const f = hours.map((h) => temp(base, swing, h)), w = hours.map((h) => skies[Math.floor(h / 240) % 6]);
      return { n, m, a, z, k: w[0], t: f[0], h: base + swing, l: base - swing, f, w, x };
    })
  };
}
