// Injected into a <style> under #tc-root at runtime (see mount.tsx) so it never
// leaks into Teams' own DOM.
import css from "./styles.css?inline";
export const CSS = css;
