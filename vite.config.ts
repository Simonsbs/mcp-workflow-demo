import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
export default defineConfig({
  plugins: [
    react(),
    {
      name: "local-documents",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const match = req.url?.match(
            /^\/docs\/(README|BUILD_NOTES|CONTRACT|VALIDATION)\.md$/,
          );
          if (!match || req.method !== "GET") {
            next();
            return;
          }
          try {
            res.setHeader("Content-Type", "text/markdown; charset=utf-8");
            res.end(await readFile(match[1] + ".md", "utf8"));
          } catch {
            next();
          }
        });
      },
    },
  ],
  server: {
    port: 5178,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8790", changeOrigin: false } },
  },
  build: { outDir: ".runtime/client", emptyOutDir: true, sourcemap: true },
});
