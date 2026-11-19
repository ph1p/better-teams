// Send layer for Teams Calm.
//
// We deliberately do NOT replay Teams' undocumented internal POST endpoints
// (they change and need the live auth token). Instead we drive Teams' own
// composer: navigate the native client to the target conversation, type into
// its contenteditable, and trigger its real send. This reuses Teams' entire
// authenticated send pipeline, so it keeps working across Teams updates.
//
// Safety: before typing we check that the native composer belongs to the
// target conversation (the send button carries data-track-thread-id). If it
// does not, we abort instead of risking a message to the wrong person.

import type { WriteResult } from "./types";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const SEND_BUTTON =
  '[data-tid="sendMessageCommands-send"], [data-tid="newMessageCommands-send"], button[name="send"]';

// Thread id the native composer currently targets, or "" if unknown.
function nativeThreadId(): string {
  const b = document.querySelector("button[data-track-thread-id]");
  return (b && b.getAttribute("data-track-thread-id")) || "";
}

async function waitFor<T>(fn: () => T, ms = 2500, step = 100): Promise<T> {
  for (let t = 0; t < ms; t += step) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return fn();
}

// Open a conversation in the underlying native client by clicking its sidebar
// row. The native list is virtualized (collapsed folders render no rows), so
// this only works for rows Teams currently renders — favorites and expanded
// folders. Rows carry the conversation id in data-fui-tree-item-value.
export async function openNativeChat(conversationId: string, title?: string): Promise<boolean> {
  if (nativeThreadId() === conversationId) return true;
  const rows = [...document.querySelectorAll('[role="treeitem"]')] as HTMLElement[];
  const row =
    rows.find((r) => (r.getAttribute("data-fui-tree-item-value") || "").includes(conversationId)) ||
    rows.find((r) => (r.outerHTML || "").includes(conversationId)) ||
    (title ? rows.find((r) => (r.innerText || "").trim().split("\n")[0].trim() === title.trim()) : undefined);
  if (!row) return false;
  row.scrollIntoView({ block: "center" });
  row.click();
  return !!(await waitFor(() => nativeThreadId() === conversationId));
}

function findComposer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-tid="ckeditor"][contenteditable="true"]') ||
    document.querySelector<HTMLElement>('[data-tid="ckeditor"] [contenteditable="true"]') ||
    document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')
  );
}

// Insert text into a contenteditable the way a paste does, so Teams' editor
// picks it up through its own input handling.
function setComposerText(el: HTMLElement, text: string): void {
  el.focus();
  const sel = window.getSelection();
  if (sel) sel.selectAllChildren(el);
  const ok = document.execCommand && document.execCommand("insertText", false, text);
  if (!ok) {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
    );
  }
}

export async function sendMessage(conversationId: string, title: string, text: string): Promise<WriteResult> {
  if (!text || !text.trim()) return { ok: false, reason: "empty" };
  const opened = await openNativeChat(conversationId, title);
  if (!opened) return { ok: false, reason: "chat-not-open" };
  if (nativeThreadId() !== conversationId) return { ok: false, reason: "wrong-chat" };

  const composer = await waitFor(findComposer);
  if (!composer) return { ok: false, reason: "no-composer" };
  setComposerText(composer, text);

  const btn = await waitFor(() => {
    const b = document.querySelector<HTMLButtonElement>(SEND_BUTTON);
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, 1500);
  // Re-check right before sending: the user may have clicked elsewhere.
  if (nativeThreadId() !== conversationId) return { ok: false, reason: "wrong-chat" };
  if (btn) {
    btn.click();
    return { ok: true, via: "button" };
  }
  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
  composer.dispatchEvent(new KeyboardEvent("keydown", opts));
  composer.dispatchEvent(new KeyboardEvent("keyup", opts));
  return { ok: true, via: "enter" };
}
