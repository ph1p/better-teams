// Unit tests (vitest). Separate from vite.config.ts, whose non-mock build is an
// IIFE library with NODE_ENV forced to production.
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify("test"),
    __VERSION__: JSON.stringify("test"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
