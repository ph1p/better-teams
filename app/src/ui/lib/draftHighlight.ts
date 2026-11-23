// Live markdown styling for the composer, Slack-style. The textarea's own text
// is transparent; a backdrop behind it renders the same text with spans for
// code, bold, strike, italic and @mentions. Styles must never change glyph
// widths (no font or padding changes), or the caret drifts from the text.
// Output is a segment tree rendered by React: Teams enforces Trusted Types, so
// assigning an HTML string to innerHTML throws there.

import { FENCE_CLOSE, FENCE_OPEN } from "../../markdown";

/** Plain text, or a styled span around more segments. */
export type Seg = string | { cls: string; kids: Seg[] };

const span = (cls: string, ...kids: Seg[]): Seg => ({ cls, kids });

// Same marks src/markdown.ts renders on send; code first, nothing nests in it.
const INLINE =
  /`([^`\n]+)`|\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*|~~(?=\S)([^~\n]+?)(?<=\S)~~|(?<![*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])|(?<!\w)_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)/g;

function mentions(text: string, re: RegExp | null): Seg[] {
  if (!re) return text ? [text] : [];
  const out: Seg[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(span("tc-hl-at", m[0]));
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function inline(line: string, re: RegExp | null): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const m of line.matchAll(INLINE)) {
    out.push(...mentions(line.slice(at, m.index), re));
    const [whole, code, bold, strike, it1, it2] = m;
    const inner = code ?? bold ?? strike ?? it1 ?? it2;
    const mk = span("tc-hl-mark", whole.slice(0, (whole.length - inner.length) / 2));
    const body = code !== undefined ? [inner] : mentions(inner, re);
    const cls =
      code !== undefined ? "tc-hl-code" : bold !== undefined ? "tc-hl-b" : strike !== undefined ? "tc-hl-s" : "tc-hl-i";
    out.push(span(cls, mk, ...body, mk));
    at = m.index + whole.length;
  }
  out.push(...mentions(line.slice(at), re));
  return out;
}

/** Matcher for the picked @mentions' display names (null: none picked). */
export function mentionRe(names: readonly string[]): RegExp | null {
  if (!names.length) return null;
  const alts = [...names]
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`@(?:${alts})`, "g");
}

/** Draft text → backdrop segments; `re` from mentionRe. */
export function highlightDraft(text: string, re: RegExp | null = null): Seg[] {
  let fenced = false;
  const out: Seg[] = [];
  text.split("\n").forEach((line, i) => {
    if (i) out.push("\n");
    // Same fence rules as the sender (src/markdown.ts).
    if (fenced ? FENCE_CLOSE.test(line) : FENCE_OPEN.test(line)) {
      fenced = !fenced;
      out.push(span("tc-hl-fence", line));
    } else out.push(...(fenced ? [span("tc-hl-pre", line)] : inline(line, re)));
  });
  // A trailing newline needs a glyph after it, or the backdrop is a line short.
  out.push("​");
  return out;
}
