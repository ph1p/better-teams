// Live markdown styling for the composer, Slack-style. The textarea's own text
// is transparent; a backdrop behind it renders the same text with spans for
// code, bold, strike, italic and @mentions. Styles must never change glyph
// widths (no font or padding changes), or the caret drifts from the text.
// Output is a segment tree rendered by React: Teams enforces Trusted Types, so
// assigning an HTML string to innerHTML throws there.

import { FENCE_CLOSE, FENCE_OPEN } from "../../markdown";

/** Plain text, or a styled span around more segments (color: a code token). */
export type Seg = string | { cls: string; kids: Seg[]; color?: string };

/** Code → colored token lines (highlight.ts), or null when not highlighted. */
export type CodeTokens = (code: string, lang: string) => { content: string; color?: string }[][] | null;

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

/** Draft text → backdrop segments; `re` from mentionRe, `code` colors fenced code. */
export function highlightDraft(text: string, re: RegExp | null = null, code?: CodeTokens): Seg[] {
  const lines = text.split("\n");
  const out: Seg[] = [];
  for (let i = 0; i < lines.length;) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) {
      out.push(...inline(lines[i], re));
      if (++i < lines.length) out.push("\n");
      continue;
    }
    // A ``` block (same fence rules as the sender, src/markdown.ts) becomes one
    // display:block span, so it can carry a full-width background. The line
    // break after it goes inside: a newline right after a block would add an
    // empty line, while one closing the block adds none.
    let j = i + 1;
    while (j < lines.length && !FENCE_CLOSE.test(lines[j])) j++;
    const body = lines.slice(i + 1, j);
    const toks = body.length ? code?.(body.join("\n"), open[1]) : null;
    const kids: Seg[] = [span("tc-hl-fence", lines[i])];
    body.forEach((line, k) => {
      const tk = toks?.[k];
      kids.push(
        "\n",
        tk
          ? span("tc-hl-pre", ...tk.map((t) => ({ cls: "", kids: [t.content], color: t.color })))
          : span("tc-hl-pre", line),
      );
    });
    if (j < lines.length) kids.push("\n", span("tc-hl-fence", lines[j]));
    i = Math.min(j, lines.length - 1) + 1;
    if (i < lines.length) kids.push("\n");
    out.push(span("tc-hl-block", ...kids));
  }
  // A trailing newline needs a glyph after it, or the backdrop is a line short.
  out.push("\u200b");
  return out;
}
