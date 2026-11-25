import { useLayoutEffect, useRef } from "react";
import { usePref } from "../lib/prefs";
import { useLatest } from "../lib/latest";

/** Keep at least this much room for the chat column. */
export const CHAT_MIN = 380;

/** Root class while a right pane can't fit beside the chat and covers it. */
export const COVER = "tc-pane-cover";

interface PaneResizeProps {
  /** Pref key the width is saved under. */
  pref: string;
  /** CSS var on #tc-root that the grid columns (and the pane) read. */
  cssVar: string;
  /** Default width: px, or a share (0–1) with `share`. */
  def: number;
  /** Narrowest the pane gets, always px. A right pane with less room covers the chat. */
  min: number;
  /** Widest the pane gets: px, or a share (0–1) with `share`. */
  max: number;
  /** Which edge of its pane the handle sits on (and so which way widens it). */
  edge: "left" | "right";
  label: string;
  /** Width the other columns already take, so the chat keeps CHAT_MIN. */
  taken: (root: HTMLElement) => number;
  /** Save the width as a share of the room beside `taken` instead of px, so
   *  the pane grows and shrinks with the window. */
  share?: boolean;
}

// Drag handle on a pane's edge. The width lives in a pref and in a CSS var on
// #tc-root. While dragging only the var changes; the pref is written once on
// release. Double-click or Home resets.
export function PaneResize({ pref, cssVar, def, min, max, edge, label, taken, share = false }: PaneResizeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = usePref(pref, def);
  const root = () => ref.current?.closest<HTMLElement>("#tc-root") ?? null;
  // Window width minus the other columns: what the chat and this pane share.
  const base = (r = root()) => window.innerWidth - (r ? taken(r) : 0);
  // Room left once the chat has its minimum.
  const room = (r = root()) => base(r) - CHAT_MIN;
  const toPx = (v: number, r = root()) => (share ? v * base(r) : v);
  const fromPx = (px: number, r = root()) => (share ? px / Math.max(1, base(r)) : px);
  const clamp = (px: number, r = root(), space = room(r)) =>
    Math.round(Math.max(min, Math.min(px, toPx(max, r), space)));
  const apply = (px: number, r = root()): void => r?.style.setProperty(cssVar, `${px}px`);
  // A right pane that can't keep `min` beside the chat covers the chat instead.
  const fit = (v: number, r = root()): void => {
    if (!r) return;
    if (edge === "left") r.classList.toggle(COVER, room(r) < min);
    apply(clamp(toPx(v, r), r), r);
  };

  // Re-fit when the window changes size: a share-sized pane follows it, and
  // the chat column keeps its room either way.
  const fitTo = useLatest(fit);
  useLayoutEffect(() => {
    const onResize = () => fitTo.current(width);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // Only on a saved width change: a re-render mid-drag must not snap back.
  }, [width, fitTo]);
  // The cover state belongs to the open pane; closing it clears it.
  useLayoutEffect(() => {
    const r = ref.current?.closest<HTMLElement>("#tc-root");
    return () => {
      if (edge === "left") r?.classList.remove(COVER);
    };
  }, [edge]);

  const dir = edge === "right" ? 1 : -1;
  const step = (px: number) => setWidth((w) => fromPx(clamp(toPx(w) + dir * px)));
  const pct = (v: number) => Math.round(v * 100);
  return (
    <div
      ref={ref}
      className={"tc-side-resize " + edge}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={share ? 0 : min}
      aria-valuemax={share ? pct(max) : max}
      aria-valuenow={share ? pct(width) : width}
      aria-valuetext={share ? `${pct(width)}%` : undefined}
      title={label}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const startX = e.clientX;
        // The other columns hold still during a drag: measure them once.
        const r = root();
        const space = room(r);
        const startW = el.parentElement?.getBoundingClientRect().width ?? toPx(width, r);
        let w = startW;
        el.setPointerCapture(e.pointerId);
        r?.classList.add("tc-resizing");
        const move = (ev: PointerEvent) => {
          w = clamp(startW + dir * (ev.clientX - startX), r, space);
          apply(w, r);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          r?.classList.remove("tc-resizing");
          setWidth(fromPx(w, r));
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      onDoubleClick={() => setWidth(def)}
      onKeyDown={(e) => {
        const by = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") step(-by);
        else if (e.key === "ArrowRight") step(by);
        else if (e.key === "Home") setWidth(def);
        else return;
        e.preventDefault();
      }}
    />
  );
}

/** Width of a right pane docked as the third grid column (0 when overlaid or covering the chat). */
export const dockedWidth = (root: HTMLElement) => {
  if (root.classList.contains(COVER)) return 0;
  const el = root.querySelector<HTMLElement>(":scope > .tc-pane");
  return el && getComputedStyle(el).position !== "fixed" ? el.getBoundingClientRect().width : 0;
};

/** Width of the left sidebar. */
export const sideWidth = (root: HTMLElement) =>
  root.querySelector<HTMLElement>(":scope > .tc-side")?.getBoundingClientRect().width ?? 0;
