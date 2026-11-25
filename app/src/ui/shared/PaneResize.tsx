import { useLayoutEffect, useRef } from "react";
import { usePref } from "../lib/prefs";
import { useLatest } from "../lib/latest";

/** Keep at least this much room for the chat column. */
export const CHAT_MIN = 420;

interface PaneResizeProps {
  /** Pref key the width is saved under. */
  pref: string;
  /** CSS var on #tc-root that the grid columns (and the pane) read. */
  cssVar: string;
  def: number;
  min: number;
  max: number;
  /** Which edge of its pane the handle sits on (and so which way widens it). */
  edge: "left" | "right";
  label: string;
  /** Width the other columns already take, so the chat keeps CHAT_MIN. */
  taken: (root: HTMLElement) => number;
}

// Drag handle on a pane's edge. The width lives in a pref and in a CSS var on
// #tc-root. While dragging only the var changes; the pref is written once on
// release. Double-click or Home resets.
export function PaneResize({ pref, cssVar, def, min, max, edge, label, taken }: PaneResizeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = usePref(pref, def);
  const root = () => ref.current?.closest<HTMLElement>("#tc-root") ?? null;
  // Room left once the chat and the other columns have theirs.
  const room = (r = root()) => window.innerWidth - CHAT_MIN - (r ? taken(r) : 0);
  const clamp = (w: number, space = room()) => Math.round(Math.max(min, Math.min(w, max, space)));
  const apply = (w: number, r = root()): void => r?.style.setProperty(cssVar, `${w}px`);

  // Re-clamp when the window shrinks so the chat column keeps its room.
  const fitTo = useLatest((w: number) => apply(clamp(w)));
  useLayoutEffect(() => {
    const fit = () => fitTo.current(width);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
    // Only on a saved width change: a re-render mid-drag must not snap back.
  }, [width, fitTo]);

  const dir = edge === "right" ? 1 : -1;
  return (
    <div
      ref={ref}
      className={"tc-side-resize " + edge}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      title={label}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const startX = e.clientX;
        const startW = el.parentElement?.getBoundingClientRect().width ?? width;
        let w = startW;
        el.setPointerCapture(e.pointerId);
        // The other columns hold still during a drag: measure them once.
        const r = root();
        const space = room(r);
        r?.classList.add("tc-resizing");
        const move = (ev: PointerEvent) => {
          w = clamp(startW + dir * (ev.clientX - startX), space);
          apply(w, r);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          r?.classList.remove("tc-resizing");
          setWidth(w);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      onDoubleClick={() => setWidth(def)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") setWidth((w) => clamp(w - dir * step));
        else if (e.key === "ArrowRight") setWidth((w) => clamp(w + dir * step));
        else if (e.key === "Home") setWidth(def);
        else return;
        e.preventDefault();
      }}
    />
  );
}

/** Width of a right pane docked as the third grid column (0 when overlaid). */
export const dockedWidth = (root: HTMLElement) => {
  const el = root.querySelector<HTMLElement>(":scope > .tc-pane");
  return el && getComputedStyle(el).position !== "fixed" ? el.getBoundingClientRect().width : 0;
};

/** Width of the left sidebar. */
export const sideWidth = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(":scope > .tc-side")?.getBoundingClientRect().width ?? 0;
