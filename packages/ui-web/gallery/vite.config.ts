// Gallery dev server: `pnpm --filter @smriti/ui-web dev`. Serves the draft Agnes art from design/mocks/assets
// at /assets/ so <Illustration> resolves names exactly as it will against the CDN.
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const assetsDir = join(here, "..", "..", "..", "design", "mocks", "assets");

function mockAssets(): Plugin {
  const serve: Plugin["configureServer"] = (server) => {
    server.middlewares.use("/assets", (req, res, next) => {
      const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/")).replace(/^(\.\.[/\\])+/, "");
      const file = join(assetsDir, rel);
      if (!file.startsWith(assetsDir) || !existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader("Content-Type", file.endsWith(".webp") ? "image/webp" : file.endsWith(".json") ? "application/json" : "application/octet-stream");
      createReadStream(file).pipe(res);
    });
  };
  return { name: "smriti-mock-assets", configureServer: serve, configurePreviewServer: serve as Plugin["configurePreviewServer"] };
}

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), mockAssets()],
  server: { port: 5181, host: "127.0.0.1", fs: { allow: [join(here, "..", "..", "..")] } },
  preview: { port: 5182, host: "127.0.0.1" },
  build: { outDir: join(here, "dist"), emptyOutDir: true },
});
