// Live refresh: Teams keeps rendering its own UI under the overlay, and its
// IndexedDB writes happen in a worker we can't hook. So a DOM change outside
// #tc-root is the earliest in-page signal that new data landed. Teams' DOM is
// quiet when nothing happens, so this costs nothing at rest; the poll stays as
// a fallback. One shared observer, throttled, fans out to subscribers.

// Overlay hidden (⌥⌘T) or window in background: don't poll IndexedDB.
export const isIdle = () => {
  if (document.hidden) return true;
  const root = document.getElementById("tc-root");
  return !!root && root.style.display === "none";
};

const LIVE_THROTTLE_MS = 300;
const liveSubs = new Set<() => void>();
let liveObs: MutationObserver | null = null;

export function onTeamsChange(cb: () => void) {
  liveSubs.add(cb);
  if (!liveObs) {
    let timer: ReturnType<typeof setTimeout> | 0 = 0;
    const fire = () => {
      timer = 0;
      for (const f of liveSubs) f();
    };
    liveObs = new MutationObserver((recs) => {
      if (timer) return;
      const root = document.getElementById("tc-root");
      const outside = recs.some((r) => {
        const el = r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement;
        return el && !(root && root.contains(el));
      });
      if (outside) timer = setTimeout(fire, LIVE_THROTTLE_MS);
    });
    liveObs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  return () => {
    liveSubs.delete(cb);
    if (!liveSubs.size && liveObs) {
      liveObs.disconnect();
      liveObs = null;
    }
  };
}
