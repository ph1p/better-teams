import { useEffect, useState, type RefObject } from "react";
import { isIdle } from "../lib/live";
import { viewerOpen } from "../lib/files";
import { requestEdit } from "../lib/editRequest";

interface MessageNav {
  /** Id of the picked message, null when none. */
  selected: string | null;
  /** Pick the newest rendered message (Arrow Up in the empty composer). */
  selectLast: () => boolean;
}

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

// Keyboard message picking: Arrow Up in the empty composer picks the newest
// message, ↑/↓ walk the rendered messages in on-screen order, E edits the
// picked one (if mine), Esc / ↓ past the newest / typing return to the
// composer. A click anywhere or a chat switch drops the pick.
export function useMessageNav(
  list: RefObject<HTMLElement | null>,
  composer: RefObject<HTMLTextAreaElement | null>,
  chatId: string | null,
): MessageNav {
  const [selected, setSelected] = useState<string | null>(null);
  const ids = (): string[] =>
    [...(list.current?.querySelectorAll<HTMLElement>(".tc-msg[data-mid]") ?? [])].map((el) => el.dataset.mid!);

  useEffect(() => setSelected(null), [chatId]);

  useEffect(() => {
    if (!selected) return;
    list.current?.querySelector(`.tc-msg[data-mid="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
    const back = (): void => {
      setSelected(null);
      composer.current?.focus();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (isIdle() || viewerOpen() || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const all = ids();
      const i = all.indexOf(selected);
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const next = i < 0 ? all.length - 1 : i + (e.key === "ArrowUp" ? -1 : 1);
        if (next >= all.length) back();
        else setSelected(all[Math.max(0, next)] ?? null);
      } else if (e.key === "e" || e.key === "E") {
        if (requestEdit(selected, () => composer.current?.focus())) setSelected(null);
      } else if (e.key === "Escape") {
        back();
      } else {
        // Any other printable key: back to the composer, which receives it.
        if (e.key.length === 1) back();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    const onDown = (): void => setSelected(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
    // ids reads list.current at event time; refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  return {
    selected,
    selectLast: () => {
      const last = ids().at(-1);
      if (!last) return false;
      // Move focus off the textarea onto the list, so the arrow keys reach the
      // window listener. A plain blur lets Teams pull focus into its own
      // hidden editor, which would swallow the keys.
      list.current?.focus({ preventScroll: true });
      setSelected(last);
      return true;
    },
  };
}
