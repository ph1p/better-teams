import { useEffect, useState } from "react";

// The current time, refreshed every `everyMs`. Keeps render pure: components
// compare against this instead of calling Date.now() while rendering.
export function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(h);
  }, [everyMs]);
  return now;
}
