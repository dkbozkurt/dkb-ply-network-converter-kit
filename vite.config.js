import { defineConfig } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// GitHub Pages serves project sites from https://<user>.github.io/<repo>/,
// so production builds need the repo name as the base path. Override with
// BASE_PATH (e.g. BASE_PATH=/ for a custom domain or user/organisation site).
const REPO_BASE = "/dkb-ply-network-converter-kit/";

// Where the dev server writes conversion logs. Ignored by git.
const TEMP_LOG_DIR = join(process.cwd(), "temp", "logs");

// Dev-only endpoint: the browser has no filesystem, so while running
// `npm run dev` the UI POSTs each conversion's process log here and the
// dev server drops it into temp/logs/<timestamp>_<name>.txt. In the
// static GitHub Pages build this endpoint does not exist and the UI
// falls back to the "Download log" button + the log bundled in the zip.
function devLogSink() {
  return {
    name: "dev-log-sink",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/log", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const { name, text } = JSON.parse(body || "{}");
            const safe = String(name || "conversion")
              .replace(/\.txt$/i, "")
              .replace(/[^\w.-]+/g, "_")
              .slice(0, 100);
            const stamp = new Date().toISOString().replace(/[:.]/g, "-");
            mkdirSync(TEMP_LOG_DIR, { recursive: true });
            const file = join(TEMP_LOG_DIR, `${stamp}_${safe}.txt`);
            writeFileSync(file, String(text || ""), "utf8");
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true, file }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: e.message }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: process.env.BASE_PATH ?? (command === "build" ? REPO_BASE : "/"),
  plugins: [devLogSink()],
  css: {
    preprocessorOptions: {
      scss: { api: "modern-compiler" },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
}));
