// Small per-device UI preferences (sidebar density, collapsed sections),
// persisted in localStorage. Teams' page may block storage, so every access is
// guarded and the UI falls back to the default value.
import { useCallback, useState } from "react";

export const PREFIX = "better-teams:";
// Keys saved before the app was renamed from Teams Calm; read as a fallback.
const OLD_PREFIX = "teams-calm:";

export function read<T>(key: string, fallback: T) {
  try {
    const raw = localStorage.getItem(PREFIX + key) ?? localStorage.getItem(OLD_PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function write<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage blocked: keep the in-memory value only */
  }
}

export function usePref<T>(key: string, fallback: T): [T, (v: T | ((cur: T) => T)) => void] {
  const [val, setVal] = useState(() => read(key, fallback));
  const set = useCallback(
    (v: T | ((cur: T) => T)) => {
      setVal((cur) => {
        const next = typeof v === "function" ? (v as (c: T) => T)(cur) : v;
        write(key, next);
        return next;
      });
    },
    [key],
  );
  return [val, set];
}
