// Copy-to-clipboard with a short "copied" flag for the button's check mark.

import { useEffect, useRef, useState } from "react";

const SHOW_MS = 1200;

export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (text: string): void => {
    if (!text) return;
    Promise.resolve(navigator.clipboard?.writeText(text))
      .then(() => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), SHOW_MS);
      })
      .catch(() => {
        /* clipboard blocked; ignore */
      });
  };
  return [copied, copy];
}
