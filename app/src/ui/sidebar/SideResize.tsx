import { useLayoutEffect, useRef } from "react";
import { usePref } from "../lib/prefs";
import { t } from "../../i18n";

const DEFAULT = 300;
const MIN = 220;
const MAX = 520;
/** Keep at least this much room for the chat column. */
const CHAT_MIN = 420;

const clamp = (w: number) => Math.round(Math.max(MIN, Math.min(w, MAX, window.innerWidth - CHAT_MIN)));

// Drag handle on the sidebar's right edge. The width lives in a pref and in the
// --tc-side-w var on #tc-root, which the grid columns read. While dragging only
// the var changes; the pref is written once on release.
export function SideResize() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = usePref("sidebarWidth", DEFAULT);
  const root = () => ref.current?.closest<HTMLElement>("#tc-root") ?? null;
  const apply = (w: number): void => root()?.style.setProperty("--tc-side-w", `${w}px`);

  // Re-clamp when the window shrinks so the chat column keeps its room.
  useLayoutEffect(() => {
    const fit = () => apply(clamp(width));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [width]);

  return (
    <div
      ref={ref}
      className="tc-side-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={t().sidebar.resize}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={width}
      title={t().sidebar.resize}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        const startX = e.clientX;
        const startW = el.parentElement?.getBoundingClientRect().width ?? width;
        let w = startW;
        el.setPointerCapture(e.pointerId);
        root()?.classList.add("tc-resizing");
        const move = (ev: PointerEvent) => {
          w = clamp(startW + ev.clientX - startX);
          apply(w);
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          root()?.classList.remove("tc-resizing");
          setWidth(w);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      onDoubleClick={() => setWidth(DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") setWidth((w) => clamp(w - step));
        else if (e.key === "ArrowRight") setWidth((w) => clamp(w + step));
        else if (e.key === "Home") setWidth(DEFAULT);
        else return;
        e.preventDefault();
      }}
    />
  );
}
