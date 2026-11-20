// Small per-device UI preferences (sidebar density, collapsed sections),
// persisted in localStorage. Teams' page may block storage, so every access is
// guarded and the UI falls back to the default value.
import { useCallback, useState } from "react";

const PREFIX = "teams-calm:";

export function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked: keep the in-memory value only */
  }
}

// useState that survives reloads. The setter takes a value or an updater.
export function usePref<T>(key: string, fallback: T): [T, (v: T | ((cur: T) => T)) => void] {
  const [val, setVal] = useState<T>(() => read(key, fallback));
  const set = useCallback((v: T | ((cur: T) => T)): void => {
    setVal((cur) => {
      const next = typeof v === "function" ? (v as (c: T) => T)(cur) : v;
      write(key, next);
      return next;
    });
  }, [key]);
  return [val, set];
}
