import { useEffect, useRef, type MutableRefObject } from "react";
import { nativeDriven, nativeThreadId } from "../../send";
import { useLatest } from "../lib/latest";
import type { Chat } from "../../types";

const POLL = 400;
// A chat Teams opened that the list doesn't know yet (brand new) is retried
// until the next chat polls bring it in, then given up.
const PENDING_MS = 15_000;

/**
 * Follow Teams' own chat switches into the overlay. Clicking a macOS
 * notification makes Teams open that chat natively, underneath the overlay;
 * without this the overlay kept showing the old chat. Switches the overlay
 * caused itself (sends, calls, new chats) are ignored, see nativeDriven().
 */
export function useFollowNative(
  sel: string | null,
  chats: Chat[],
  chatsRef: MutableRefObject<Chat[]>,
  open: (id: string) => void,
) {
  const last = useRef("");
  const pending = useRef<{ id: string; at: number } | null>(null);
  const selRef = useLatest(sel);
  const openRef = useLatest(open);

  const tryOpen = () => {
    const p = pending.current;
    if (!p) return;
    if (Date.now() - p.at > PENDING_MS || p.id === selRef.current) {
      pending.current = null;
      return;
    }
    if (!chatsRef.current.some((c) => c.id === p.id)) return;
    pending.current = null;
    openRef.current(p.id);
  };

  useEffect(() => {
    last.current = nativeThreadId();
    const tick = () => {
      const id = nativeThreadId();
      if (id === last.current) return;
      last.current = id;
      if (!id || nativeDriven()) return;
      pending.current = { id, at: Date.now() };
      tryOpen();
    };
    // Hidden window: skip the poll; the focus event below checks on return.
    const t = setInterval(() => {
      if (!document.hidden) tick();
    }, POLL);
    // Teams comes to the front on a notification click: check right away.
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new chat may only show up with the next chat list poll.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(tryOpen, [chats]);
}
