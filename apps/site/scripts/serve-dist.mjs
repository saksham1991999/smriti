#!/usr/bin/env node
// Minimal static server for dist/, used by the Playwright smoke and the screenshot script.
// Behaves like the static host: directory index.html, trailing-slash redirect, 404.html.
//
//   node scripts/serve-dist.mjs [port] [distDir]

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

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

const send = (res, status, file) => {
  res.writeHead(status, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(dist, path);
  if (!file.startsWith(dist)) return send(res, 404, join(dist, "404.html"));
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { location: `${url.pathname}/${url.search}` });
      return res.end();
    }
    file = join(file, "index.html");
  }
  if (existsSync(file) && statSync(file).isFile()) return send(res, 200, file);
  return send(res, 404, join(dist, "404.html"));
}).listen(port, "127.0.0.1", () => console.log(`serving ${dist} on http://127.0.0.1:${port}`));
