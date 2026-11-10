# Bot API: widget methods and updates

Source: https://core.telegram.org/bots/api (Bot API 10.4). All methods are `POST https://api.telegram.org/bot<token>/<method>` with a JSON body.

## sendWidget

Sends a message with a widget. Returns the sent `Message` with its `widget` (`Widget`: `id` for a shared widget, `width`, `height`, `html`, `public_data`, `chat_data`).

| Parameter | Type | Notes |
|---|---|---|
| `chat_id` | Integer or String | required; in production a private chat with the bot |
| `message_thread_id` | Integer | forum topic |
| `html` | String | required; 1–32768 bytes, ≤4096 bytes after zlib level 9; no U+0000 |
| `width` | Integer | logical px; omit for the bubble's full width (clamped to 200…bubble max) |
| `height` | Integer | logical px; omit for content height (clamped 50–600) |
| `public_data` | String | 0–1024 bytes, seen wherever the widget is shown |
| `chat_data` | String | 0–1024 bytes, tied to this message |
| `allow_queries` | Boolean | the widget may send requests to the bot |
| `is_shared` | Boolean | create a shared widget (one object, one `public_data`) |
| `caption`, `parse_mode`, `caption_entities` | | 0–1024 characters; what notifications and older apps show |
| `show_caption_above_media` | Boolean | the caption above; the time is then drawn over the widget's corner |
| `disable_notification`, `protect_content`, `reply_parameters`, `reply_markup`, `message_effect_id`, `allow_paid_broadcast` | | as for other media |

In production, widgets "can be sent only to private chats, and sent widgets automatically have protected content".

## sendSharedWidget

Sends an existing shared widget again: `chat_id`, `widget_id` (required), its own `chat_data`, a caption and the usual message options. Code, size, request flag and `public_data` are the shared widget's.

## answerWidgetQuery

`widget_query_id` (required), `data` (optional, 0–1024 bytes). Must be called **within 15 seconds**, which is also how long the id is valid (a late answer fails with `query is too old`). The answer goes only to the widget that asked and doesn't change any state.

## editMessageWidgetData

Changes a message's widget state, silently (no "edited", no notification).

- Target: `chat_id` + `message_id`, or `inline_message_id`.
- `public_data`, `chat_data`: 0–1024 bytes; omitted = unchanged, `""` = cleared.
- An edit that changes nothing fails with `Bad Request: message is not modified`: treat it as done.
- Counts as one sent message against the bot's send limits.

## editSharedWidgetData

`widget_id`, `public_data` (required), `cache_time` (5–3600 s; the refresh period apps poll at while a widget that called `watchPublicData()` is visible; 30 by default). At most one edit per second per shared widget: coalesce bursts (votes).

## Updates

Add both to `allowed_updates` if you pass it.

**`widget_query`** (`WidgetQuery`), from an original message:

| Field | |
|---|---|
| `id` | the query id for `answerWidgetQuery` |
| `from` | `User` who tapped, authenticated by Telegram |
| `chat`, `message_id` | the message (absent for inline messages) |
| `inline_message_id` | for messages sent via the bot |
| `chat_instance` | |
| `chat_type` | inline messages only |
| `type` | `WidgetQueryType`: `{ "type": "data" }`, or wallet types (`wallet_card`, `sent_transaction`) |
| `data` | 1–64 bytes from `TelegramWidget.request(data)` |
| `widget_id` | for a shared widget |

**`shared_widget_query`** (`SharedWidgetQuery`), from a forward of a shared widget: only `id`, `from`, `type`, `data`, `widget_id`. Key one-per-user actions on `(widget_id, from.id)`.

The query doesn't carry the widget's state: keep it yourself and check every request against it.

## Errors

| Error | Cause |
|---|---|
| `INPUT_MEDIA_WIDGET_TOO_LARGE` | HTML over 32768 bytes or over 4096 bytes compressed |
| `INPUT_MEDIA_WIDGET_HTML_INVALID` | invalid UTF-8 or a NUL character |
| `INPUT_MEDIA_WIDGET_DATA_TOO_LARGE` | `chat_data`/`public_data` over 1024 bytes (sending and edits) |
| `INPUT_MEDIA_WIDGET_DATA_INVALID` / `WIDGET_DATA_INVALID` | invalid state text at sending / in edits |
| `WIDGET_RESULT_TOO_LARGE` | answer data over 1024 bytes |
| `query is too old` | answered after 15 s |
| `message is not modified` | the edit changed nothing; not a failure |
| flood wait (429) | send limits, or more than one shared-widget edit per second |

## Minimal calls

```js
const api = (method, body) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}).then((r) => r.json());

const sent = await api("sendWidget", { chat_id, html, chat_data: JSON.stringify(state), caption, allow_queries: true });
if (!sent.ok) await api("sendMessage", { chat_id, text: caption }); // fallback

// on update.widget_query
await api("answerWidgetQuery", { widget_query_id: q.id, data: JSON.stringify({ ok: true }) });
await api("editMessageWidgetData", { chat_id: q.chat.id, message_id: q.message_id, chat_data: JSON.stringify(next) });
```
