import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Builds the whole app (React included) into ONE self-contained IIFE file with
// no external imports, so it can be injected as a single string over CDP into
// the Teams page and run from there. CSS is injected by the app itself (see
// styles.js), so we disable CSS code-splitting.
// __BUILD__ must change on every rebuild, or mount.tsx sees the same version on
// re-injection and keeps the old app. `define` is evaluated once per config
// load (once for the whole `vite build --watch` session), so define a
// placeholder and stamp the real id into each emitted chunk.
const BUILD_PLACEHOLDER = "__TC_BUILD_ID__";
const buildId = () => ({
  name: "tc-build-id",
  renderChunk(code) {
    return code.split(BUILD_PLACEHOLDER).join(String(Date.now()));
  },
});

export default defineConfig({
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
