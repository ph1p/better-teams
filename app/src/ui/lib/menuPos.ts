import type { CSSProperties } from "react";

// Minimum gap between a popup menu and the window edges.
export const MENU_MARGIN = 8;

/**
 * Fixed-position style for a popup menu anchored to a span from `top` to
 * `bottom` at `x`. In the lower half of the window it is anchored by its
 * bottom edge, so it opens upwards and stays on screen; `width` keeps it off
 * the right edge, `gap` spaces it from the anchor. It always keeps
 * MENU_MARGIN from every window edge; a menu taller than the room left gets
 * a max-height and scrolls (.tc-menu has overflow-y: auto).
 */
export function menuPos(x: number, top: number, bottom: number, width: number, gap = 0): CSSProperties {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const left = Math.max(MENU_MARGIN, Math.min(x, w - width - MENU_MARGIN));
  if (top > h / 2) {
    const b = Math.max(MENU_MARGIN, h - top + gap);
    return { left, bottom: b, maxHeight: h - b - MENU_MARGIN };
  }
  const t = Math.min(h - MENU_MARGIN, bottom + gap);
  return { left, top: t, maxHeight: Math.max(0, h - t - MENU_MARGIN) };
}
