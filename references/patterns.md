# Patterns from the examples

What carries over from [weather](../examples/weather.html), [checkout](../examples/checkout.html)
and [achievement](../examples/achievement.html) to other widgets.

## Drawing

**Disappear without `opacity`.** `opacity` < 1 makes an element heavy (16 at once stop the widget).
Hide by `transform: scale(0)`, fade by an `rgba()`/`hsla()` color, draw many dots as `box-shadow`s of
one element in `currentColor` (fade them all by its `color`), end a ring by shrinking its border to 0.

```css
@keyframes rg { from { transform: scale(.4); border-width: 8px } to { transform: scale(2.2); border-color: transparent } }
```

**A stage has its own colors.** A sky or a dark medal stage is a picture: fixed colors, `px` sizes,
white text. Everything on the bubble uses the theme variables and `em`. Dim a bright stage in dark
(`colorScheme == 'dark'`) and redraw on `themeChanged`.

**Keep text on top, and out of the way.** Text goes after every animated layer in the DOM, and
moving things stay out of its box: clouds sized in `vw` in the right half, confetti in the band
between the label and the title. Numbers that sit where the sun sets go *into* the ground, in
the theme's text color. There is no `text-shadow` to rescue them.

**A scene is a vector of numbers.** Gradients don't transition. Turn the state into numbers
(colors as ints, positions, heights), and tween any two vectors with `requestAnimationFrame` for
700 ms; a tap, new data and a theme switch all animate the same way.

```js
paint({ c: to.c.map((c, i) => mix(from.c[i], c, e)), n: to.n.map((x, i) => from.n[i] + (x - from.n[i]) * e) });
```

**Replay an animation by rebuilding its nodes.** New nodes always run their animations; no forced
reflow. For a small pop on the same node, alternate two identical keyframes (`p0`/`p1`): a changed
`animation-name` restarts it.

**A rolling number** is a column of digits per place, moved by `translateY`:

```css
.o { display: inline-block; height: 1em; overflow: hidden; vertical-align: bottom }
.o b { display: block; white-space: pre; transition: transform .5s cubic-bezier(.2,.8,.2,1) }
```
```js
[...el.children].forEach((c, i) => c.firstChild.style.transform = `translateY(-${digit[i] * 10}%)`);
```

**Balance two lines yourself.** No `text-wrap: balance`: break at the space nearest the middle
(`lastIndexOf(' ', length / 2 + 4)`) and show it with `white-space: pre-line`.

## State and requests

**One door for state.** The bot answers a request with the same JSON it then writes with
`editMessageWidgetData`. The widget passes both through one `take()`; whichever comes first draws.

**Edit on the device, send at the commit.** Steppers and a coupon change only the device's copy
(`localStorage`); one request at Pay carries the whole cart, so a retry after `TIMEOUT` repeats
the same request and the bot answers with what it already did. Counters carry the value they saw
(`+4`): the bot counts it only if its own value is still 4.

**Who may ask.** `const can = !!W.viewer && !W.isPreview && !W.isForward;` `viewer` exists only
where requests may be sent. When `can` is false, draw the state read-only and say where to act
("Open the chat with the bot to order").

**No keyboard.** A promo code is a button the bot offers in the state. A code the user types goes
to the chat; the bot reads the message and edits `chat_data`.

**A shared widget** (`is_shared`): one `public_data` for every message, with a revision `r` the
widget never goes back from; `watchPublicData()` while visible; `editSharedWidgetData` with
`cache_time` (5–3600 s, at most one edit per second). Each message's `chat_data` picks the view
(`{"i":1}` opens the second city). The same HTML can read the whole state from `chat_data`, so a
static send is the fallback.

## Telegram Stars from a widget

1. Pay sends the cart (`p210c1`). The bot recounts the total from its own prices.
2. `sendInvoice` with `currency: "XTR"`, `provider_token: ""`, one price, payload
   `<chat>:<message>:<attempt>`; then the answer and the edit to "waiting".
3. `pre_checkout_query`, within 10 s: `ok` only for the latest attempt of a waiting order, the
   same total, `XTR`, from the order's owner.
4. `message.successful_payment`: the state turns paid; keep `telegram_payment_charge_id`.
5. "Change the order" deletes the invoice and raises the attempt; after 10 minutes the bot does the
   same and marks the order expired.
6. Refunds: `refundStarPayment(user_id, telegram_payment_charge_id)`. Bots that take Stars answer
   `/paysupport`. Stars are for digital goods only.

## Size

Measured on these files (zlib level 9): the one-line header comment instead of eight lines,
about −270 bytes; arrows and `const` over ES5, about −100; markup generated in loops (stars,
rain, confetti, a rosette); icons combined from two or three `<symbol>`s with `<use>`.
Node's zlib counts 50–70 bytes more than the server (Python's `zlib.compress(data, 9)`):
pass `check-size.mjs`, and near 4096 confirm with Python.
