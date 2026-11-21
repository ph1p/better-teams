import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "src");
const MOCK = path.join(SRC, "mock");

// Builds the whole app (React included) into ONE self-contained IIFE file with
// no external imports, so it can be injected as a single string over CDP into
// the Teams page and run from there. CSS is injected by the app itself (see
// styles.js), so we disable CSS code-splitting.
// __BUILD__ must change on every rebuild, or mount.tsx sees the same version on
// re-injection and keeps the old app. `define` is evaluated once per config
// load (once for the whole `vite build --watch` session), so define a
// placeholder and stamp the real id into each emitted chunk.
const BUILD_PLACEHOLDER = "__TC_BUILD_ID__";
const buildId = (): Plugin => ({
  name: "tc-build-id",
  renderChunk(code: string) {
    return code.split(BUILD_PLACEHOLDER).join(String(Date.now()));
  },
});

// `vite --mode mock`: run the app in a plain browser tab. Every module that
// talks to Teams (its IndexedDB, worker or DOM) resolves to its stand-in under
// src/mock/ instead; the mocks themselves still import the real files (types).
const MOCKED = ["teamsData.ts", "send.ts", "services/chat.ts", "services/typing.ts", "services/presence.ts"];
const mockTeams = (): Plugin => ({
  name: "tc-mock-teams",
  enforce: "pre",
  async resolveId(source, importer, options) {
    if (!importer || importer.startsWith(MOCK)) return null;
    const hit = await this.resolve(source, importer, { ...options, skipSelf: true });
    if (!hit) return null;
    const rel = path.relative(SRC, hit.id).split(path.sep).join("/");
    return MOCKED.includes(rel) ? path.join(MOCK, rel) : null;
  },
});

export default defineConfig(({ mode }) => mode === "mock"
  ? {
      plugins: [mockTeams(), tailwindcss(), react()],
      define: { __BUILD__: JSON.stringify("mock") },
      server: { port: 5199, open: true },
    }
  : {
      plugins: [tailwindcss(), react(), buildId()],
      define: { "process.env.NODE_ENV": '"production"', __BUILD__: JSON.stringify(BUILD_PLACEHOLDER) },
      build: {
        outDir: "dist",
        cssCodeSplit: false,
        lib: {
          entry: "src/mount.tsx",
          name: "TeamsCalmApp",
          formats: ["iife"],
          fileName: () => "teams-calm-app.js",
        },
        rollupOptions: {
          output: { inlineDynamicImports: true },
        },
        minify: "esbuild",
      },
    });
