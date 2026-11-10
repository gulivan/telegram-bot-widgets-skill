# Inside the widget: `TelegramWidget`, events, CSS, limits

Source: https://core.telegram.org/bots/widgets. `window.TelegramWidget` exists before the first script runs; no script tag to include. Outside Telegram it's `undefined`: guard for it when opening the file in a browser.

## The document

- One HTML document (or a bare fragment), inline `<style>` and `<script>`, images only as `data:` URLs or inline SVG.
- JavaScript runs in **QuickJS**, not a browser. The app checks every DOM change against the widget profile (`profile` = 1) and draws only what passes. It looks the same on iOS, Android, macOS, Desktop and web.
- `fetch`, `XMLHttpRequest`, `WebSocket` throw `NetworkDisabledError`. External scripts, styles, fonts, images never load; no navigation. No library is bundled.
- The only form control is `<button>`; inputs, selects and text areas are removed. No keyboard.

## TelegramWidget

| Member | |
|---|---|
| `chatData`, `publicData` | the state as text (≤1024 B) or `null`; read-only |
| `request(data[, {wallet:true}])` | Promise of `{ result }` (the bot's answer, or `null`); rejects with `WidgetRequestError` |
| `colorScheme` | `light` / `dark` |
| `themeParams` | frozen palette (`bg_color`, `text_color`, `hint_color`, `link_color`, `button_color`, `button_text_color`, `secondary_bg_color`, `accent_text_color`, `subtitle_text_color`, `destructive_text_color`, `section_separator_color`, …) |
| `isActive`, `isPreview`, `isForward` | visibility; inline-result preview; forwarded copy |
| `chatType` | `private`, `group`, `supergroup`, `channel`, or `null` |
| `viewer` | `{ id, first_name, last_name?, username?, is_premium? }`, only where the widget may send requests |
| `watchPublicData()`, `unwatchPublicData()` | poll a shared widget's `public_data` while visible |
| `copyText(text)` | 1–256 chars, on a tap; the app shows a toast |
| `openLink(url)` | external `https:` ≤256 chars, after the user confirms; on a tap |
| `openTelegramLink(url)` | `https://t.me/…` inside Telegram; on a tap |
| `HapticFeedback` | `impactOccurred(light/medium/heavy/rigid/soft)`, `notificationOccurred(error/success/warning)`, `selectionChanged()` |
| `contentSafeAreaInset` | `{ bottom, cornerLeft, cornerRight, … }` the band the time covers |
| `setResizeAnchor('top'/'bottom')` | which edge stays put when height changes; check `typeof … === 'function'` |
| `ready()` | optional: the first state is drawn |
| `onEvent(type, fn)`, `offEvent` | ≤16 handlers per type |
| `wallet` | TON wallet (`sendTransaction`, `signData`) or `null` |

There's no `sendMessage`, and the widget isn't told its `widget_id`.

## Requests

- **On a tap only, synchronously** in the tap's handler; not from `setTimeout`, a `.then`, or `requestAnimationFrame`. One tap unlocks one call, shared with `openLink`, `openTelegramLink`, `copyText`.
- **One in flight**; another call rejects with `BUSY`.
- **Background**: only the original in the private chat with the bot, while visible: one call when it appears, then at most one per 5 s. A call in the script's first lines waits and goes out when the widget appears.
- Data 1–64 bytes UTF-8, otherwise `TypeError` before anything is sent.
- Error codes: `NOT_ALLOWED` (no `allow_queries`, no tap, preview, static forward), `BUSY`, `RATE_LIMITED` (5 per 5 s per user and bot), `TIMEOUT` (bot didn't answer in 15 s or doesn't receive `widget_query`), `FAILED`, `INVALID_ANSWER`; wallet: `REJECTED`, `BAD_REQUEST`.

```js
const W = window.TelegramWidget;
button.addEventListener('click', () => {
  W.request('vote:2').then((a) => show(a.result), (e) => showError(e.code));
});
```

## Events

`chatDataChanged`, `publicDataChanged` (state already updated: redraw), `themeChanged`, `activated` / `deactivated` (visibility), `contentSafeAreaChanged`. Handlers get no arguments, `this` is `TelegramWidget`.

```js
function render() { let s = null; try { s = JSON.parse(W.chatData); } catch (e) {} /* draw from s */ }
W.onEvent('chatDataChanged', render);
render();
```

## CSS variables (on the root, `!important`)

`--tg-theme-<key>` for every `themeParams` key (`--tg-theme-bg-color`, `--tg-theme-text-color`, `--tg-theme-hint-color`, `--tg-theme-button-color`, `--tg-theme-secondary-bg-color`, `--tg-theme-section-separator-color`, …), `--tg-color-scheme`, `--tg-text-font-size` (~15px), `--tg-text-line-height` (~1.35), `--tg-text-padding` (~8px 12px), `--tg-button-*`, `--tg-content-safe-area-inset-*`, `--tg-content-safe-area-corner-left/right`. `prefers-color-scheme`, `light-dark()` and `color-scheme` follow the chat's theme. `prefers-reduced-motion` works.

## Storage

`localStorage` and `sessionStorage`: per message, per device, 4 KB per area, `QuotaExceededError` beyond (catch it). Never synced, never sent. Good for "voted", a best score, taps not yet confirmed by the bot.

## Limits that stop or slow the widget

| Limit | Value | Beyond |
|---|---|---|
| Nodes | 2000 | stopped |
| DOM changes in one task | 10000 | stopped |
| Text | 32K UTF-16 units per value, 48K in the document | stopped |
| Attribute or inline style | 8K units | stopped |
| CSS | 400 rules, 32 `@keyframes` | stopped |
| Heavy elements | 16 at once with blurred `box-shadow`, `filter`, `backdrop-filter` or `opacity` < 1 (max 2 `backdrop-filter`) | stopped |
| One task | 500 ms of JavaScript (first run included) | stopped |
| CPU | 300 ms per second | slowed |
| Layout reads | 128 blocking reads per task, ≤1000 ms total | stopped |
| Memory | 8 MB | stopped |
| Timers | 64 live | `RangeError` |
| Canvas | 2048×2048 px total, 4000 commands per task | stopped / `RangeError` |
| `data:` images | 1024×1024 px | placeholder |
| Script animations | 64 running | not drawn |
| Crashes | 2 in a row | stays stopped until app restart |

Mute with color (`--tg-theme-hint-color`, `rgba()`), not `opacity`: it costs nothing against the heavy-element cap.
