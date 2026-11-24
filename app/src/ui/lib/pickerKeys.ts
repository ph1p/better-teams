import { useState, type KeyboardEvent } from "react";

export const scrollNear = (el: HTMLElement | null): void => el?.scrollIntoView({ block: "nearest" });

export function usePickerKeys<T>(hits: readonly T[], pick: (hit: T) => void, close: () => void) {
  const [raw, setHi] = useState(0);
  // The list can shrink under the highlight (directory hits arrive late).
  const hi = Math.min(raw, Math.max(0, hits.length - 1));
  // Returns false for keys left to the caller.
  const onKey = (e: KeyboardEvent) => {
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
