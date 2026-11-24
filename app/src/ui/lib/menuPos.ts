import type { CSSProperties } from "react";

export const MENU_MARGIN = 8;

/**
 * Fixed-position style for a popup menu anchored to a span from `top` to
 * `bottom` at `x`. In the lower half of the window it is anchored by its
 * bottom edge, so it opens upwards and stays on screen; `width` keeps it off
 * the right edge, `gap` spaces it from the anchor. It always keeps
 * MENU_MARGIN from every window edge; a menu taller than the room left gets
 * a max-height and scrolls (.tc-menu has overflow-y: auto). With `align:
 * "right"`, `x` is the anchor's right edge and the menu's right edge lines up
 * with it (a "…" button at the end of a header).
 */
export function menuPos(
  x: number,
  top: number,
  bottom: number,
  width: number,
  gap = 0,
  align: "left" | "right" = "left",
): CSSProperties {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const edge = Math.max(MENU_MARGIN, Math.min(align === "left" ? x : w - x, w - width - MENU_MARGIN));
  const side = align === "left" ? { left: edge } : { right: edge };
  if (top > h / 2) {
    const b = Math.max(MENU_MARGIN, h - top + gap);
    return { ...side, bottom: b, maxHeight: h - b - MENU_MARGIN };
  }
  const t = Math.min(h - MENU_MARGIN, bottom + gap);
  return { ...side, top: t, maxHeight: Math.max(0, h - t - MENU_MARGIN) };
}
