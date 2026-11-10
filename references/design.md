# Designing a widget

## Native look

- The bubble is the canvas. Leave the root without a background, so `--tg-theme-bg-color` shows through. A background on `html`/`body` paints the whole bubble.
- The app inserts default styles under yours: message text color and size, body margin equal to the bubble's text padding (~8px 12px), native headings, lists, tables, `<button>` in the client's style with `:active` and `[disabled]`. Any rule of yours wins.
- Use the theme variables, `em` sizes and system fonts (`system-ui`, `sans-serif`, `serif`, `monospace`, `ui-*`). Fixed colors are fine only for meaning (right/wrong), never for contrast with the bubble.
- Test in light and dark, and in an outgoing bubble (a widget the user forwarded or sent via the bot takes their bubble's colors).

A widget with no CSS already looks like a message:

```html
<h3>Order #1042</h3>
<p>2 × Margherita, 1 × Lemonade</p>
<p><strong>Total: $23.50</strong></p>
<button onclick="TelegramWidget.openLink('https://example.com/orders/1042')">Track the order</button>
```

## Sizes

- Width: bubbles are 200–600 px, about 320–430 px on phones. Lay out with `%`, flex or grid; `@media (max-width)` and `vw` refer to the bubble.
- Height: content height, 50–600 px. Content beyond is clipped; nothing scrolls inside, no fullscreen. Stay under ~560 px at 320 px wide.
- Pass `width`/`height` to `sendWidget` only when you know them; it fixes the placeholder before the first render.
- Growing at the bottom (a log, a thread): `setResizeAnchor('bottom')` before the change.

## The time in the corner

Without a caption below, the app draws the time over the widget's bottom corner. Keep tappable things out of it:

```css
.footer { padding-bottom: max(8px, env(safe-area-inset-bottom));
          padding-right: max(12px, var(--tg-content-safe-area-corner-right)); }
```

The default styles already add the band to the body's bottom padding; if you pad for it yourself, set `body { padding: 0 }` too or you get it twice.

## Gestures

| Over an element with | Hold | Horizontal drag | Vertical drag |
|---|---|---|---|
| `touch-action: auto` (default) | message menu | swipe-to-reply | chat scrolls |
| `touch-action: pan-y` | message menu | the widget | chat scrolls |
| `touch-action: none` | the widget (`contextmenu`) | the widget | chat scrolls |

Taps and double taps are always the widget's. Vertical drags are always the chat's: no vertical sliders, wheel pickers or drawing. When the chat takes a press the widget gets `pointercancel` and no `click`. Keep controls off the leading 20 px (the back gesture).

## Guidelines

- Draw the first state at once, synchronously, from the state you have.
- Always send a caption: chat list, notifications, search and older apps show only it.
- Stay small: SVG and CSS compress, `data:` images don't.
- Show progress and every outcome of a request ("Sending…", the answer, each error).
- Code and `public_data` are public; in a group `chat_data` is seen by every member. No secrets.
- No `:hover`, no keyboard. `aria-*` does nothing yet: put what matters in the caption.
- Text isn't selectable unless you set `user-select: text`; for one-tap copy use `copyText`.
