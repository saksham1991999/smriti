#!/usr/bin/env node
// Minimal static server for dist/, used by the Playwright smoke and the screenshot script.
// Behaves like the static host: directory index.html, trailing-slash redirect, 404.html.
//
//   node scripts/serve-dist.mjs [port] [distDir]

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { createBrotliCompress } from "node:zlib";

const port = Number(process.argv[2] ?? 4321);
const dist = resolve(process.argv[3] ?? "dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

// Text is compressed, as the static host does, so local Lighthouse runs measure what ships.
const COMPRESS = new Set([".html", ".css", ".js", ".json", ".svg", ".xml", ".txt"]);

const send = (res, status, file, req) => {
  const ext = extname(file);
  const br = COMPRESS.has(ext) && /\bbr\b/.test(String(req?.headers["accept-encoding"] ?? ""));
  res.writeHead(status, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    ...(br ? { "content-encoding": "br", vary: "accept-encoding" } : {}),
  });
  const stream = createReadStream(file);
  (br ? stream.pipe(createBrotliCompress()) : stream).pipe(res);
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(dist, path);
  if (!file.startsWith(dist)) return send(res, 404, join(dist, "404.html"), req);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { location: `${url.pathname}/${url.search}` });
      return res.end();
    }
    file = join(file, "index.html");
  }
  if (existsSync(file) && statSync(file).isFile()) return send(res, 200, file, req);
  return send(res, 404, join(dist, "404.html"), req);
}).listen(port, "127.0.0.1", () => console.log(`serving ${dist} on http://127.0.0.1:${port}`));
