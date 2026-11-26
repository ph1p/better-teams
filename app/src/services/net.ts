// Network health of this machine, so the UI can say "offline" / "connection
// unstable" instead of failing one action at a time. Signals:
// - the browser's online/offline events (instant, but only knows "no link"),
// - Network Information API hints (slow-2g/2g) where available,
// - a same-origin probe, run when a backend call fails (http.ts) and every few
//   seconds while degraded. Only the probe decides: a failed API fetch can also
//   be CORS or a blocked endpoint, which looks exactly like a network error.
// CDL traffic (sends, reactions) runs through Teams' client, not http.ts, so
// it never triggers a probe; the browser events still cover a dropped link.
import { useSyncExternalStore } from "react";

export type NetState = "online" | "unstable" | "offline";

/** One probe: ok=false means it got no response at all. */
export interface Sample {
  at: number;
  ok: boolean;
  ms: number;
}

const WINDOW = 30_000;
const SLOW_MS = 2_500;
const PROBE_EVERY = 5_000;
const PROBE_TIMEOUT = 6_000;

/**
 * Classify from recent probes. Offline: the browser says so, or the last two
 * probes both failed. Unstable: a failed probe or 2+ slow ones in the last
 * 30 s, or the browser reports a very slow link. Old probes age out.
 */
export function classify(samples: Sample[], now: number, browserOnline: boolean, slowLink: boolean): NetState {
  if (!browserOnline) return "offline";
  const recent = samples.filter((s) => now - s.at < WINDOW);
  const last2 = recent.slice(-2);
  if (last2.length === 2 && last2.every((s) => !s.ok)) return "offline";
  if (slowLink) return "unstable";
  if (recent.some((s) => !s.ok)) return "unstable";
  if (recent.filter((s) => s.ms > SLOW_MS).length >= 2) return "unstable";
  return "online";
}

type Conn = { effectiveType?: string; addEventListener?: (t: string, f: () => void) => void };
const conn = (): Conn | undefined => (navigator as unknown as { connection?: Conn }).connection;
const slowLink = () => {
  const t = conn()?.effectiveType;
  return t === "slow-2g" || t === "2g";
};

let samples: Sample[] = [];
let state: NetState = "online";
const subs = new Set<() => void>();
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probing = false;

function update() {
  const now = Date.now();
  const linked = navigator.onLine !== false;
  samples = samples.slice(-20);
  const next = classify(samples, now, linked, slowLink());
  if (next !== state) {
    state = next;
    subs.forEach((f) => f());
  }
  // Probe only while the probes themselves say degraded and could clear it:
  // not while the browser has no link (the "online" event probes) and not for
  // a slow-link hint alone (the connection "change" event updates that).
  if (linked && classify(samples, now, true, false) !== "online") scheduleProbe();
  else stopProbe();
}

// Any answer from our own origin proves the link works, redirects included:
// redirect "manual" stops at the 302 (Teams' root redirects, possibly to the
// login host, which would fail CORS). Not no-cors: per the Fetch spec, no-cors
// with a non-"follow" redirect mode is always a network error.
async function probe() {
  if (probing) return;
  probing = true;
  stopProbe();
  const ctl = new AbortController();
  const kill = setTimeout(() => ctl.abort(), PROBE_TIMEOUT);
  const t0 = performance.now();
  let ok = true;
  try {
    await fetch(location.origin + "/?tc-probe=" + Date.now(), {
      method: "HEAD",
      mode: "same-origin",
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: ctl.signal,
    });
  } catch {
    ok = false;
  } finally {
    clearTimeout(kill);
    probing = false;
  }
  samples.push({ at: Date.now(), ok, ms: performance.now() - t0 });
  update();
}

function scheduleProbe() {
  if (probeTimer || probing) return;
  probeTimer = setTimeout(() => void probe(), PROBE_EVERY);
}

function stopProbe() {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
}

let lastSuspect = 0;
/**
 * A backend fetch threw (http.ts): check the link. Throttled harder while the
 * last probe was fine, so an endpoint that always fails (CORS) can't keep
 * probing every few seconds.
 */
export function suspect() {
  const now = Date.now();
  const healthy = state === "online" && samples.at(-1)?.ok !== false;
  if (now - lastSuspect < (healthy ? WINDOW : PROBE_EVERY)) return;
  lastSuspect = now;
  void probe();
}

let started = false;
/** Hook up browser events once; safe to call repeatedly. */
function startNetWatch() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("offline", update);
  // "online" only means a link exists: confirm with a probe before going green.
  window.addEventListener("online", () => void probe());
  conn()?.addEventListener?.("change", update);
  update();
}

export const netState = () => state;

const subscribe = (f: () => void) => {
  startNetWatch();
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const useNet = () => useSyncExternalStore(subscribe, netState);
