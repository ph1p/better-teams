import { useEffect } from "react";

// Close a popup (menu, picker) on any outside click, scroll, Escape, or resize.
// The capture-phase handlers run before React's own, so events that start
// inside `inside` (a CSS selector: the popup and its toggle) are ignored;
// otherwise mousedown would unmount an item before its click lands.
export function useDismiss(open: boolean, inside: string, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.target instanceof Element && e.target.closest(inside)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}
