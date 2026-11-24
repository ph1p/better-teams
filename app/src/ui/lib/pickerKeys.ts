// Keys of a search box over a hit list (new chat, forward): Arrow Up/Down move
// the highlight and wrap, Enter picks the highlighted hit, Escape closes.
import { useState, type KeyboardEvent } from "react";

/** Ref callback: keeps the highlighted hit in view while arrowing. */
export const scrollNear = (el: HTMLElement | null): void => el?.scrollIntoView({ block: "nearest" });

export function usePickerKeys<T>(
  hits: readonly T[],
  pick: (hit: T) => void,
  close: () => void,
): {
  hi: number;
  setHi: (i: number) => void;
  /** Handles the key and returns true, or returns false for the caller to handle. */
  onKey: (e: KeyboardEvent) => boolean;
} {
  const [raw, setHi] = useState(0);
  // The list can shrink under the highlight (directory hits arrive late).
  const hi = Math.min(raw, Math.max(0, hits.length - 1));
  const onKey = (e: KeyboardEvent): boolean => {
    const n = hits.length;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) setHi((hi + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    else if (e.key === "Enter" && hits[hi]) pick(hits[hi]);
    else if (e.key === "Escape") close();
    else return false;
    e.preventDefault();
    return true;
  };
  return { hi, setHi, onKey };
}
