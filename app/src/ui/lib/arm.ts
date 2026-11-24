// Two-click confirm for destructive buttons: the first click arms a key, a
// second click on the same key within ARM_MS acts. Arming lapses on its own.
import { useEffect, useState } from "react";

const ARM_MS = 3000;

export function useArm<K>() {
  const [armed, setArmed] = useState<K | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const h = setTimeout(() => setArmed(null), ARM_MS);
    return () => clearTimeout(h);
  }, [armed]);
  const tryArm = (key: K, act: () => void) => {
    if (armed !== key) {
      setArmed(key);
      return;
    }
    setArmed(null);
    act();
  };
  return { armed, tryArm, disarm: () => setArmed(null) };
}
