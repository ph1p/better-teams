// Markdown-aware key handling shared by the composer and the inline editor.
//
//   Enter inside an open ``` fence   newline (keeps indentation), not send
//   Enter on a ```lang line          opens the block and adds the closing fence
//   Tab / Shift+Tab inside a fence   indent / outdent the current line
//   Shift+Enter in a list item       continues the list; on an empty item ends it
//   Cmd/Ctrl+B / I / E               **bold** / *italic* / `code`
//   Cmd/Ctrl+Shift+X                 ~~strike~~
//   Cmd/Ctrl+Shift+C                 code block dialog (onCodeBlock)
//
// Edits go through execCommand("insertText") so the browser's undo stack and
// React's onChange both see them.

import type { KeyboardEvent } from "react";
import { FENCE_CLOSE, FENCE_OPEN, inOpenFence } from "../../markdown";

const INDENT = "  ";

/** Replace [start,end) of the textarea's value with `text`; caret/selection after. */
export function replaceText(
  el: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  selFrom?: number,
  selTo?: number,
) {
  el.focus();
  el.setSelectionRange(start, end);
  const done = typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!done) {
    // Fallback: set the value natively so React's onChange still fires.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, el.value.slice(0, start) + text + el.value.slice(end));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  const a = start + (selFrom ?? text.length);
  el.setSelectionRange(a, start + (selTo ?? selFrom ?? text.length));
}

function lineBounds(v: string, at: number): [number, number] {
  const s = v.lastIndexOf("\n", at - 1) + 1;
  const e = v.indexOf("\n", at);
  return [s, e < 0 ? v.length : e];
}

export function wrapSelection(el: HTMLTextAreaElement, mark: string) {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const sel = v.slice(s, e);
  if (v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark) {
    replaceText(el, s - mark.length, e + mark.length, sel, 0, sel.length);
    return;
  }
  if (sel.includes("\n")) {
    // Inline marks never span lines: wrap each non-blank line on its own.
    const out = sel
      .split("\n")
      .map((l) => (l.trim() && !/^\s*```/.test(l) ? mark + l + mark : l))
      .join("\n");
    replaceText(el, s, e, out, 0, out.length);
    return;
  }
  replaceText(el, s, e, mark + sel + mark, mark.length, mark.length + sel.length);
}

export function indent(el: HTMLTextAreaElement, out: boolean) {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  if (!out && s === e) {
    replaceText(el, s, s, INDENT);
    return;
  }
  const ls = lineBounds(v, s)[0];
  // A selection ending at a line start leaves that line alone.
  const le = lineBounds(v, e > s && v[e - 1] === "\n" ? e - 1 : e)[1];
  const block = v.slice(ls, le);
  const lines = block.split("\n");
  const next = lines.map((l) => (out ? l.replace(/^( {1,2}|\t)/, "") : l ? INDENT + l : l));
  const text = next.join("\n");
  if (text === block) return;
  const from = Math.max(ls, s + next[0].length - lines[0].length);
  replaceText(el, ls, le, text, from - ls, Math.max(from, e + text.length - block.length) - ls);
}

export function codeNewline(el: HTMLTextAreaElement) {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const line = v.slice(lineBounds(v, s)[0], s);
  let ind = /^[ \t]*/.exec(line)?.[0] ?? "";
  if (/[{[(:]\s*$/.test(line)) ind += INDENT;
  replaceText(el, s, e, "\n" + ind);
}

export interface Fence {
  /** Range of the whole block, fence lines included. */
  start: number;
  end: number;
  lang: string;
  code: string;
}

export function fenceAt(v: string, at: number): Fence | null {
  let pos = 0;
  let open: { start: number; lang: string; body: number } | null = null;
  for (const line of v.split("\n")) {
    const ls = pos;
    const le = pos + line.length;
    pos = le + 1;
    if (!open) {
      const m = FENCE_OPEN.exec(line);
      if (m) open = { start: ls, lang: m[1], body: Math.min(pos, v.length) };
      continue;
    }
    if (!FENCE_CLOSE.test(line)) continue;
    if (at >= open.start && at <= le)
      return { start: open.start, end: le, lang: open.lang, code: v.slice(open.body, Math.max(open.body, ls - 1)) };
    open = null;
  }
  return open && at >= open.start
    ? { start: open.start, end: v.length, lang: open.lang, code: v.slice(open.body) }
    : null;
}

export function putCodeBlock(el: HTMLTextAreaElement, start: number, end: number, lang: string, code: string) {
  const v = el.value;
  const pre = start > 0 && v[start - 1] !== "\n" ? "\n" : "";
  const post = end < v.length && v[end] !== "\n" ? "\n" : "";
  replaceText(el, start, end, pre + "```" + lang + "\n" + code.replace(/\s+$/, "") + "\n```" + post);
}

// Returns true when the key was consumed; the caller then skips its own
// handling (send, cancel, …).
export function handleFormatKey(e: KeyboardEvent<HTMLTextAreaElement>, onCodeBlock: () => void) {
  const el = e.currentTarget;
  if (e.nativeEvent.isComposing) return false;
  const mod = e.metaKey || e.ctrlKey;
  const { selectionStart: s, selectionEnd: end, value: v } = el;

  if (mod && !e.altKey) {
    const k = e.key.toLowerCase();
    const mark = !e.shiftKey
      ? ({ b: "**", i: "*", e: "`" } as Record<string, string>)[k]
      : k === "x"
        ? "~~"
        : undefined;
    if (mark) {
      e.preventDefault();
      if (mark === "`" && v.slice(s, end).includes("\n")) onCodeBlock();
      else wrapSelection(el, mark);
      return true;
    }
    if (e.shiftKey && k === "c") {
      e.preventDefault();
      onCodeBlock();
      return true;
    }
    return false;
  }

  const fenced = inOpenFence(v.slice(0, s));
  if (e.key === "Enter" && !e.shiftKey && fenced) {
    e.preventDefault();
    const [ls] = lineBounds(v, s);
    const line = v.slice(ls, s);
    // Just typed the opening fence and nothing closes it yet: add the closer.
    if (/^\s*```[\w#+.-]*\s*$/.test(line) && !/^\s*```\s*$/m.test(v.slice(s))) {
      replaceText(el, s, end, "\n\n```", 1);
      return true;
    }
    replaceText(el, s, end, "\n" + (/^[ \t]*/.exec(line)?.[0] ?? ""));
    return true;
  }
  if (e.key === "Tab" && fenced && !mod && !e.altKey) {
    e.preventDefault();
    indent(el, e.shiftKey);
    return true;
  }
  if (e.key === "Enter" && e.shiftKey && !fenced && s === end) {
    const [ls] = lineBounds(v, s);
    const m = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(v.slice(ls, s));
    if (!m) return false;
    e.preventDefault();
    if (!m[3].trim()) {
      replaceText(el, ls, s, "");
      return true;
    }
    const n = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}${m[2].slice(-1)}` : m[2];
    replaceText(el, s, s, `\n${m[1]}${n} `);
    return true;
  }
  return false;
}
