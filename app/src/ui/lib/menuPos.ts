import type { CSSProperties } from "react";

/**
 * Fixed-position style for a popup menu anchored to a span from `top` to
 * `bottom` at `x`. In the lower half of the window it is anchored by its
 * bottom edge, so it opens upwards and stays on screen; `width` keeps it off
 * the right edge, `gap` spaces it from the anchor.
 */
export function menuPos(x: number, top: number, bottom: number, width: number, gap = 0): CSSProperties {
  return {
    left: Math.min(x, window.innerWidth - width),
    ...(top > window.innerHeight / 2 ? { bottom: window.innerHeight - top + gap } : { top: bottom + gap }),
  };
}
