// Overlay styling, authored in Tailwind v4 (styles.css) and compiled to a string
// at build time via Vite's ?inline. Injected into a <style> under #tc-root at
// runtime (see mount.tsx) so it never leaks into Teams' own DOM.
import css from "./styles.css?inline";
export const CSS: string = css;
