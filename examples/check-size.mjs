#!/usr/bin/env node
/**
 * Checks a widget against Telegram's limits, counted as the server counts:
 * HTML ≤ 32768 bytes and ≤ 4096 bytes after zlib level 9, no NUL; state ≤ 1024 bytes.
 *
 *   node check-size.mjs widget.html ['<chat_data>'] ['<public_data>']
 */
import fs from "node:fs";
import zlib from "node:zlib";

const [file, chatData, publicData] = process.argv.slice(2);
if (!file) { console.error("usage: node check-size.mjs widget.html ['<chat_data>'] ['<public_data>']"); process.exit(2); }

const html = fs.readFileSync(file);
const packed = zlib.deflateSync(html, { level: 9 }).length;
const rows = [
  ["html", html.length, 32768],
  ["html, zlib level 9", packed, 4096],
  ...(chatData != null ? [["chat_data", Buffer.byteLength(chatData), 1024]] : []),
  ...(publicData != null ? [["public_data", Buffer.byteLength(publicData), 1024]] : [])
];
let ok = !html.includes(0);
if (!ok) console.log("html contains a NUL byte: INPUT_MEDIA_WIDGET_HTML_INVALID");
for (const [name, size, max] of rows) {
  const fits = size <= max;
  ok &&= fits;
  console.log(`${fits ? "ok  " : "OVER"} ${name}: ${size} / ${max} bytes`);
}
// Node's zlib packs a little worse than the server's; near the limit, the server's count may still fit.
if (packed > 3996) console.log("near the limit: confirm with python3 -c 'import sys,zlib; print(len(zlib.compress(sys.stdin.buffer.read(), 9)))' < " + file);
process.exit(ok ? 0 : 1);
