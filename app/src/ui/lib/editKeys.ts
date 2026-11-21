// Markdown-aware key handling shared by the composer and the inline editor.
//
//   Enter inside an open ``` fence   newline (keeps indentation), not send
//   Enter on a ```lang line          opens the block and adds the closing fence
//   Tab / Shift+Tab inside a fence   indent / outdent the current line
//   Shift+Enter in a list item       continues the list; on an empty item ends it
//   Cmd/Ctrl+B / I / E               **bold** / *italic* / `code`
//   Cmd/Ctrl+Shift+X                 ~~strike~~
//   Cmd/Ctrl+Shift+C                 ``` code block ``` around the selection
//
// Edits go through execCommand("insertText") so the browser's undo stack and
// React's onChange both see them.

import type { KeyboardEvent } from "react";
import { inOpenFence } from "../../markdown";

const INDENT = "  ";

/** Replace [start,end) of the textarea's value with `text`; caret/selection after. */
function replace(
  el: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  selFrom?: number,
  selTo?: number,
): void {
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

/** Wrap the selection in `mark` (or insert an empty pair with the caret inside). */
export function wrapSelection(el: HTMLTextAreaElement, mark: string): void {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const sel = v.slice(s, e);
  // Already wrapped: unwrap.
  if (v.slice(s - mark.length, s) === mark && v.slice(e, e + mark.length) === mark) {
    replace(el, s - mark.length, e + mark.length, sel, 0, sel.length);
    return;
  }
  if (sel.includes("\n")) {
    // Inline marks never span lines: wrap each non-blank line on its own.
    const out = sel
      .split("\n")
      .map((l) => (l.trim() && !/^\s*```/.test(l) ? mark + l + mark : l))
      .join("\n");
    replace(el, s, e, out, 0, out.length);
    return;
  }
  replace(el, s, e, mark + sel + mark, mark.length, mark.length + sel.length);
}

/** Put the selection (or an empty line) in a fenced code block. */
export function codeBlock(el: HTMLTextAreaElement): void {
  const { selectionStart: s, selectionEnd: e, value: v } = el;
  const sel = v.slice(s, e);
  const pre = s > 0 && v[s - 1] !== "\n" ? "\n" : "";
  const post = e < v.length && v[e] !== "\n" ? "\n" : "";
  const block = pre + "```\n" + sel + "\n```" + post;
  const caret = pre.length + 4;
  replace(el, s, e, block, caret, caret + sel.length);
}

/**
 * Handle formatting keys. Returns true when the key was consumed; the caller
 * then skips its own handling (send, cancel, …).
 */
export function handleFormatKey(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
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
      if (mark === "`" && v.slice(s, end).includes("\n")) codeBlock(el);
      else wrapSelection(el, mark);
      return true;
    }
    if (e.shiftKey && k === "c") {
      e.preventDefault();
      codeBlock(el);
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
      replace(el, s, end, "\n\n```", 1);
      return true;
    }
    replace(el, s, end, "\n" + (/^[ \t]*/.exec(line)?.[0] ?? ""));
    return true;
  }
  if (e.key === "Tab" && fenced && !mod && !e.altKey) {
    e.preventDefault();
    const [ls] = lineBounds(v, s);
    if (e.shiftKey) {
      const n = /^ {1,2}|^\t/.exec(v.slice(ls, ls + INDENT.length))?.[0].length ?? 0;
      if (n) {
        replace(el, ls, ls + n, "");
        el.setSelectionRange(Math.max(ls, s - n), Math.max(ls, end - n));
      }
    } else if (s === end) {
      replace(el, s, s, INDENT);
    } else {
      replace(el, ls, ls, INDENT);
      el.setSelectionRange(s + INDENT.length, end + INDENT.length);
    }
    return true;
  }
  if (e.key === "Enter" && e.shiftKey && !fenced && s === end) {
    const [ls] = lineBounds(v, s);
    const m = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/.exec(v.slice(ls, s));
    if (!m) return false;
    e.preventDefault();
    if (!m[3].trim()) {
      replace(el, ls, s, ""); // empty item: end the list
      return true;
    }
    const n = /\d/.test(m[2]) ? `${parseInt(m[2], 10) + 1}${m[2].slice(-1)}` : m[2];
    replace(el, s, s, `\n${m[1]}${n} `);
    return true;
  }
  return false;
}
