import { useLayoutEffect, useRef } from "react";

// A ref that always holds the latest committed `value`, for long-lived
// listeners and stable callbacks that must not re-subscribe on every render.
// Written in a layout effect (not during render), so it is current before any
// event handler or effect of that commit runs.
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
