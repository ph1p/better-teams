import { useCallback, useEffect, useRef, useState } from "react";
import { useLatest } from "./latest";

// Matches the `tc-modal-out` / `tc-scrim-out` animations in styles.css.
const EXIT_MS = 140;

// Leave animation for a modal: `close()` flags the modal as closing (the
// scrim gets `.out` and plays its exit), then calls `onClose` once that is
// done. Repeat calls while closing are ignored. Reduced motion skips the wait.
export function useModalExit(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const latest = useLatest(onClose);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const close = useCallback(() => {
    if (timer.current) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      latest.current();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => latest.current(), EXIT_MS);
  }, [latest]);
  return { closing, close };
}
