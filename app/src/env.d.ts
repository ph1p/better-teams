// Ambient declarations for non-TS imports and build-time globals.

// Vite's `?inline` query returns the compiled CSS as a string.
declare module "*.css?inline" {
  const css: string;
  export default css;
}

// Shiki ships its grammars/themes/wasm as .mjs/opaque modules without types we
// need; treat them as unknown-shaped and narrow at the call site.
declare module "shiki/themes/*.mjs" {
  const theme: unknown;
  export default theme;
}
declare module "shiki/langs/*.mjs" {
  const lang: unknown;
  export default lang;
}
declare module "shiki/wasm" {
  const wasm: unknown;
  export default wasm;
}

// Injected at build time by Vite's `define` (see vite.config.ts).
declare const __BUILD__: string;
declare const __VERSION__: string;

interface Window {
  __betterTeamsApp?: {
    show: () => void;
    hide: () => void;
    toggle: () => void;
    destroy: () => void;
    version: string;
  };
}
