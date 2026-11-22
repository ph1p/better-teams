import { useState } from "react";

// True in the render where `key` differs from the previous render's key. Lets a
// component reset its state when an input changes while rendering (React's
// "adjusting state when a prop changes"), instead of in an effect that renders
// the stale state once first.
export function useChanged(key: unknown): boolean {
  const [prev, setPrev] = useState(key);
  if (Object.is(prev, key)) return false;
  setPrev(key);
  return true;
}
