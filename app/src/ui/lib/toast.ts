import { useCallback, useRef, useState } from "react";

/** Show `t` in the toast for `ms`; a newer flash replaces the current one. */
export type Flash = (t: string, ms?: number) => void;

export function useToast(): [string, Flash] {
  const [toast, setToast] = useState("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);
  const flash = useCallback((t: string, ms = 2500): void => {
    setToast(t);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setToast(""), ms);
  }, []);
  return [toast, flash];
}
