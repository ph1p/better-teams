import { useEffect, useRef, type RefObject } from "react";
import { isIdle } from "../lib/live";
import { viewerOpen } from "../lib/files";
import type { Chat } from "../../types";

interface Shortcuts {
  /** Chats in on-screen order (sections, then the bottom slot). */
  flat: Chat[];
  sel: string | null;
  pick: (id: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  msgSearchOpen: boolean;
  openMsgSearch: () => void;
  closeMsgSearch: () => void;
  toggleNotes: () => void;
  unreadOnly: boolean;
  setUnreadFilter: (on: boolean) => void;
}

// Keyboard: ⌘K search, ⌥↑/⌥↓ previous/next chat, ⌥⇧↑/⌥⇧↓ previous/next
// unread chat, ⌥U Unread filter, ⌥N notes drawer, Esc leaves search.
export function useShortcuts(opts: Shortcuts): void {
  // Latest options, so the window listener is attached once.
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isIdle() || viewerOpen()) return;
      const { flat, sel, pick, searchRef } = o.current;
      if (e.metaKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.metaKey && !e.altKey && e.key.toLowerCase() === "f") {
        // ⌘F searches within the open conversation (not the browser's find bar).
        e.preventDefault();
        e.stopPropagation();
        if (sel) o.current.openMsgSearch();
      } else if (e.key === "Escape" && o.current.msgSearchOpen) {
        o.current.closeMsgSearch();
      } else if (e.altKey && !e.metaKey && !e.shiftKey && e.code === "KeyN") {
        e.preventDefault();
        e.stopPropagation();
        o.current.toggleNotes();
      } else if (e.altKey && !e.metaKey && e.code === "KeyU") {
        e.preventDefault();
        e.stopPropagation();
        o.current.setUnreadFilter(!o.current.unreadOnly);
      } else if (e.altKey && !e.metaKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        // Next unread below (or above) the open chat, wrapping around.
        const up = e.key === "ArrowUp";
        const i = flat.findIndex((c) => c.id === sel);
        const n = flat.length;
        for (let k = 1; k <= n; k++) {
          const c = flat[((((i < 0 ? (up ? 0 : -1) : i) + (up ? -k : k)) % n) + n) % n];
          if (c && c.unread && c.id !== sel) {
            pick(c.id);
            break;
          }
        }
      } else if (e.altKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        const i = flat.findIndex((c) => c.id === sel);
        const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)))];
        if (next) pick(next.id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}
