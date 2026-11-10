---
name: telegram-bot-widgets
description: Build, send and answer Telegram bot HTML widgets (Bot API 10.4, sendWidget, widget_query, answerWidgetQuery, editMessageWidgetData, TelegramWidget JS). Use when a bot should show an interactive block inside a message (quiz, poll, chart, progress card, game, ticker, promo code, weather card, checkout with Telegram Stars, achievement badge), when handling widget_query / shared_widget_query updates, when a widget fails to send (INPUT_MEDIA_WIDGET_TOO_LARGE, HTML_INVALID), or when a widget misbehaves (requests rejected with NOT_ALLOWED/BUSY/TIMEOUT, nothing drawn, blank in dark mode, users can't screenshot).
---

# Telegram bot widgets

A widget is a small HTML document that Telegram draws **inside a message bubble**.
It runs offline in a QuickJS sandbox on the user's device, in the chat's colors.
It reads state that only the bot writes, and it can reach the bot only through
64-byte requests. Bot API 10.4 (2026-11-09) added widgets; docs:
https://core.telegram.org/bots/widgets and https://core.telegram.org/bots/api#sendwidget.

## Before you build: what works in production today

- **Private chat with the bot only.** Groups, inline mode and forwards work on the test server only.
- **Every production widget message is protected content.** It can't be forwarded or saved,
  and phones block screenshots while one is on screen. The bot can't turn this off,
  so warn whoever expects to share it.
- **Apps without widget support** show only the caption, as unsupported media.
  Always send a caption that says everything on its own.

## Workflow

1. **Decide the shape.**
   - **Static widget** (default): code and state live in the message.
   - **Shared widget** (`is_shared`): one object, one `public_data` for every message that shows it.
     Use it for a ticker or a poll.
   - **Requests** (`allow_queries`) only if the widget must talk back (answers, votes, refresh).
2. **Write the HTML.** Use [references/widget-runtime.md](references/widget-runtime.md) and
   [references/design.md](references/design.md); start from [examples/quiz.html](examples/quiz.html),
   or from the closest of [weather](examples/weather.html) (shared state, no requests),
   [checkout](examples/checkout.html) (requests and a Stars invoice),
   [achievement](examples/achievement.html) (a live state change with an animation).
   [references/patterns.md](references/patterns.md) has what carries over.
   - Draw the first state synchronously from `TelegramWidget.chatData`.
   - Use theme variables, never hard-coded colors, and no network.
3. **Check the size:** `node examples/check-size.mjs widget.html`.
   - The limits are ≤32768 bytes of HTML and ≤4096 bytes after zlib level 9, the server's count.
   - `chat_data`/`public_data` are ≤1024 **bytes** each (512 Cyrillic letters fill it).
4. **Preview locally:** `node examples/preview.mjs widget.html '<chat_data json>'` writes an HTML page
   with light and dark bubbles at phone widths and a stand-in `TelegramWidget`. It allows one
   request per tap, as the app does, and counts nodes, CSS rules and heavy elements per bubble.
5. **Send** with `sendWidget` (see [references/bot-api.md](references/bot-api.md)). On a 400,
   fall back to the same text as a normal message, so nobody misses it.
6. **Handle requests** if `allow_queries`:
   - Subscribe to `widget_query` (and `shared_widget_query`). If you pass `allowed_updates`, add both;
     otherwise every request ends in `TIMEOUT`.
   - Call `answerWidgetQuery` **within 15 s, for every query**, including failures.
   - Change state with `editMessageWidgetData`. Treat "message is not modified" as success.
   - Keep the authoritative state on your side, keyed by `(chat_id, message_id)` or `widget_id`.
     Check `from.id` and the request data against it, because the data is untrusted.
7. **Ship the HTML with the code.** Packaging that copies only `*.js`/`*.py` drops `.html` templates,
   and the bot then crashes on start (see [references/production-notes.md](references/production-notes.md)).

## Rules that bite

- **`request()` only from a tap.** Call `TelegramWidget.request()` **synchronously inside the tap handler**.
  - From a timer, a promise callback or a later frame it rejects with `NOT_ALLOWED`.
  - One tap unlocks one call (shared with `openLink`/`copyText`).
  - One request can be in flight at a time; a second gets `BUSY`.
- **Answer data isn't state.** The answer (≤1024 B) reaches only the widget that asked and changes no state;
  call `editMessageWidgetData` to change it. The widget redraws on `chatDataChanged`.
- **Layout limits.** Nothing scrolls inside a widget and there are no `vh` units.
  The height is 50–600 px; keep under ~560 px at a 320 px width.
- **Gestures.** Vertical drags always scroll the chat. Holds and horizontal drags belong to the widget
  only under `touch-action: none` / `pan-y`.
- **No form controls but `<button>`.** There are no inputs, keyboard, `<ruby>`, audio or external fonts and images.
- **Hard caps stop the widget.** Examples: 2000 nodes, 400 CSS rules, 500 ms in one task, 8 MB of memory,
  16 "heavy" elements (blur, filter, opacity < 1). See the limits table in
  [references/widget-runtime.md](references/widget-runtime.md).
- **localStorage is per message and per device:** 4 KB, never synced and never sent to the bot.
  Use it for pending taps; use `chat_data` for what must follow the user.
- **Rate limits.** Requests are limited to 5 per 5 s per user and bot.
  Each `editMessageWidgetData` counts as one sent message against the bot's limits.

## Files

- [references/bot-api.md](references/bot-api.md): methods, parameters, update objects, errors.
- [references/widget-runtime.md](references/widget-runtime.md): the `TelegramWidget` object, events, CSS variables, sandbox limits.
- [references/design.md](references/design.md): native look, sizes, the time in the corner, gestures, accessibility.
- [references/production-notes.md](references/production-notes.md): lessons from shipping widgets to real users (reliable answers, fallbacks, A/B, packaging).
- [references/patterns.md](references/patterns.md): patterns from the examples: motion without heavy elements, one door for state, safe retries, a shared widget, paying with Stars, size tricks.
- [examples/quiz.html](examples/quiz.html): a three-question quiz that records answers through the bot and survives retries.
- [examples/weather.html](examples/weather.html): a shared widget, a living sky whose horizon is the next six hours; one edit moves every message.
- [examples/checkout.html](examples/checkout.html): a cart edited on the device and paid with a Telegram Stars invoice.
- [examples/achievement.html](examples/achievement.html): a medal that unlocks live when the bot edits the state, with claim and share.
- [examples/logic.mjs](examples/logic.mjs): what the bot does with each request, as pure functions, plus sample states.
- [examples/bot.mjs](examples/bot.mjs): a dependency-free Node bot for all four examples, Stars payments (refunded) included.
- [examples/check-size.mjs](examples/check-size.mjs): checks HTML and state against Telegram's limits.
- [examples/preview.mjs](examples/preview.mjs): a local preview page with a stand-in `TelegramWidget` that answers like the bot, state buttons and a caps meter.
