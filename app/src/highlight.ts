// Code-block syntax highlighting via Shiki (shikijs).
//
// Shiki's full bundle ships every language + theme and is several MB. We use the
// fine-grained `shiki/core` build instead and hand-pick a small language set and
// one theme, so the injected overlay stays lean while real code still lights up.
//
// Teams' CSP has no 'wasm-unsafe-eval', so the Oniguruma (WASM) engine cannot
// load there. We use Shiki's pure-JS regex engine instead (no WASM, no eval).
// Init is async (grammars load once). Until it finishes, callers get null and
// render plain <pre>. When ready we re-render via an onReady hook.
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import themeDark from "shiki/themes/github-dark-default.mjs";
import themeLight from "shiki/themes/github-light-default.mjs";

import js from "shiki/langs/javascript.mjs";
import ts from "shiki/langs/typescript.mjs";
import jsx from "shiki/langs/jsx.mjs";
import tsx from "shiki/langs/tsx.mjs";
import json from "shiki/langs/json.mjs";
import python from "shiki/langs/python.mjs";
import bash from "shiki/langs/bash.mjs";
import html from "shiki/langs/html.mjs";
import css from "shiki/langs/css.mjs";
import sql from "shiki/langs/sql.mjs";
import yaml from "shiki/langs/yaml.mjs";
import md from "shiki/langs/markdown.mjs";
import go from "shiki/langs/go.mjs";
import rust from "shiki/langs/rust.mjs";
import java from "shiki/langs/java.mjs";
import csharp from "shiki/langs/csharp.mjs";

// shiki's fine-grained lang/theme modules are declared `unknown` (see env.d.ts);
// createHighlighterCore wants LanguageRegistration[] / ThemeRegistrationAny[].
// They ARE those shapes at runtime — cast once at the import boundary.
type LangInput = Parameters<typeof createHighlighterCore>[0] extends { langs: infer L } ? L : never;
type ThemeInput = Parameters<typeof createHighlighterCore>[0] extends { themes: infer T } ? T : never;

// Map common aliases Teams/users write to the grammar name Shiki knows.
const ALIAS: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  ts: "typescript",
  py: "python",
  py3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  yml: "yaml",
  md: "markdown",
  golang: "go",
  rs: "rust",
  cs: "csharp",
  "c#": "csharp",
  htm: "html",
};
const LOADED = new Set<string>([
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "json",
  "python",
  "bash",
  "html",
  "css",
  "sql",
  "yaml",
  "markdown",
  "go",
  "rust",
  "java",
  "csharp",
]);

let hl: HighlighterCore | null = null;
let initStarted = false;
const readyCbs = new Set<() => void>();

export function normLang(lang: string): string {
  const l = String(lang || "")
    .toLowerCase()
    .trim();
  const name = ALIAS[l] || l;
  return LOADED.has(name) ? name : "";
}

export function onHighlighterReady(cb: () => void): () => void {
  if (hl) return () => {};
  readyCbs.add(cb);
  return () => readyCbs.delete(cb);
}

export function initHighlighter(): void {
  if (initStarted) return;
  initStarted = true;
  createHighlighterCore({
    themes: [themeDark, themeLight] as ThemeInput,
    langs: [js, ts, jsx, tsx, json, python, bash, html, css, sql, yaml, md, go, rust, java, csharp] as LangInput,
    engine: createJavaScriptRegexEngine(),
  })
    .then((h) => {
      hl = h;
      for (const cb of readyCbs)
        try {
          cb();
        } catch {
          /* ignore */
        }
      readyCbs.clear();
    })
    .catch((e) => {
      console.warn("[better-teams] highlighter init failed; plain <pre> renders", e);
    });
}

// Highlight code to an array of {content, color, fontStyle} token lines, so the
// caller renders React spans itself (no innerHTML — Trusted Types forbids it).
// Returns null until the highlighter is ready or when the language is unknown.
export function highlightLines(code: string, lang: string): ThemedToken[][] | null {
  const name = normLang(lang);
  if (!hl || !name) return null;
  const dark = !document.documentElement.classList.contains("tc-light");
  try {
    const { tokens } = hl.codeToTokens(code, {
      lang: name,
      theme: dark ? "github-dark-default" : "github-light-default",
    });
    return tokens;
  } catch {
    return null;
  }
}
