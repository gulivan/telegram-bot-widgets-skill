# Lessons from shipping widgets

Gathered from putting a quiz widget into a learning bot's reminders and a weekly chart into its weekly report, in production, in the first days of Bot API 10.4.

## Users can't screenshot

Every production widget message is protected content, and phones refuse screenshots while one is on screen. That's Telegram's rule, not a setting. Tell whoever asked for the widget before they find out themselves, and don't build anything that depends on sharing it.

## Never lose the message

- `sendWidget` can be refused (an old limit, a bad byte, a widget-less test account): send the same text as a plain message on any 400.
- The caption must stand on its own; the widget is an addition.
- Keep the buttons (`reply_markup`) on the widget message as on the text one.

## Recording answers reliably

The pattern that survived retries, two devices and slow networks:

1. The widget keeps its own record in `localStorage`: answers given and how many the bot confirmed.
2. Each tap sends **every answer not yet confirmed** in one request (`q<idx><opt><idx><opt>…`, well under 64 bytes), from inside the tap handler.
3. The bot locks the row for that `(chat_id, message_id)` (`SELECT … FOR UPDATE`), checks `from.id` is the user it sent the widget to, and records answers **in order**, skipping ones it already has and stopping at a gap.
4. The bot answers with what it has (`{"r":[1,0]}`) and writes it into `chat_data` with `editMessageWidgetData`, so every device shows the same result.
5. The widget adopts the bot's record on `chatDataChanged` when it's ahead of its own.

So a tap that times out is resent with the next one, and nothing is counted twice.

## Requests

- Add `widget_query` (and `shared_widget_query`) to `allowed_updates` of `getUpdates`/`setWebhook`. Missing it means every request ends in `TIMEOUT` with nothing in your logs.
- Answer first, then do slow work, then edit the state. Answer even on errors, with a short code the widget can show.
- A request made in a `.then()` or a `setTimeout` is `NOT_ALLOWED`. Call `request()` in the click handler itself.

## Packaging

A widget's HTML is usually a template file next to the bot code. Build and deploy steps that copy only `*.js` (or `*.py`) leave it out, and the bot dies at startup with `ENOENT` on the template. Add the folder to the Dockerfile and to any release script, and keep a health check that would catch it.

## State budget

`chat_data` is 1024 **bytes**. Quiz items in Cyrillic or CJK run out fast: use one-letter keys (`{"q":[{"h":"…","p":"…","o":[…],"a":1}],"r":[1,0]}`), shorten option texts (cut at `;` or `(`), and check the byte length before sending.

## Measuring

- Split users stably (a hash of the account id), e.g. half get the widget, half the text, and log which variant each message was.
- Log each answer and the completion, and compare what users did after each variant (opened the app within 24 h, finished the quiz).

## Preview without a phone

Render the widget in an iframe with a stand-in `TelegramWidget` (see `examples/preview.mjs`) at 270 and 330 px, light and dark. Telegram draws a bit differently, so check one real message on a phone before calling it done.
