// Presence: Teams renders each person's status as a Fluent PresenceBadge in its
// own DOM (outside #tc-root). There is no stable REST/WS channel we can hook, so
// we read the badges the native UI already paints. Each badge carries the MRI in
// its element id ("presence-pill-8:orgid:<guid>") and the status in a LOCALISED
// aria-label. We map EN+DE labels; anything unknown resolves to "Unknown".
//
// Badges only exist for people Teams currently shows (visible chat rows, open
// profile). That's exactly the set the overlay also shows, so coverage matches.

import { useEffect, useState } from "react";
import { onTeamsChange } from "./live";
import { myMri } from "../../teamsData";

export type Status =
  | "Available"
  | "Away"
  | "BeRightBack"
  | "Busy"
  | "DoNotDisturb"
  | "Offline"
  | "Unknown";

// aria-label (lower-cased) -> status. Covers English + German (the two locales
// observed). Keys are matched case-insensitively.
const LABELS: Record<string, Status> = {
  // Available
  available: "Available",
  "verfügbar": "Available",
  // Away
  away: "Away",
  abwesend: "Away",
  // Be right back
  "be right back": "BeRightBack",
  "bin gleich zurück": "BeRightBack",
  // Busy
  busy: "Busy",
  "in a call": "Busy",
  "in a meeting": "Busy",
  beschäftigt: "Busy",
  "in besprechung": "Busy",
  "in einem anruf": "Busy",
  // Do not disturb
  "do not disturb": "DoNotDisturb",
  // Self badge (me-control) uses the raw availability token, lower-cased.
  donotdisturb: "DoNotDisturb",
  berightback: "BeRightBack",
  "nicht stören": "DoNotDisturb",
  presenting: "DoNotDisturb",
  "focusing": "DoNotDisturb",
  // Offline / away-from-keyboard
  offline: "Offline",
  "appears offline": "Offline",
  "als offline anzeigen": "Offline",
  unknown: "Unknown",
  unbekannt: "Unknown",
};

const statusFromLabel = (label: string): Status => {
  const k = label.trim().toLowerCase();
  if (LABELS[k]) return LABELS[k];
  // Substring fallback: localised labels sometimes embed the word
  // ("Available, Zuletzt aktiv …"). Check longest keys first so "in a call"
  // wins over a bare "call".
  for (const key of LABEL_KEYS) if (k.indexOf(key) !== -1) return LABELS[key];
  return "Unknown";
};
const LABEL_KEYS = Object.keys(LABELS).sort((a, b) => b.length - a.length);

// Colour-class fallback: Fluent paints the badge icon with a hashed utility
// class per colour bucket. Locale-independent, but build-fragile (hashes change
// when Teams ships a new Fluent build) and can't split Busy vs DoNotDisturb
// (same red). Used only when the aria-label is in an unmapped locale. Observed
// 2026-11-19 (Teams v2 / Fluent). Re-capture if rings lose colour after an
// update: the class is the 2nd token after "___<hash>".
const CLASS_STATUS: Record<string, Status> = {
  fqa5hgp: "Available",
  fvi85wt: "Busy",
  f14k8a89: "Away",
  f11d4kpn: "Offline",
};
const statusFromClass = (cls: string): Status => {
  for (const key in CLASS_STATUS) if (cls.indexOf(key) !== -1) return CLASS_STATUS[key];
  return "Unknown";
};
const statusOfBadge = (el: HTMLElement): Status => {
  const byLabel = statusFromLabel(el.getAttribute("aria-label") || "");
  if (byLabel !== "Unknown") return byLabel;
  return statusFromClass(el.className || "");
};

// Scrape all presence badges into an MRI -> Status map. Self badge
// (data-tid="me-control-avatar-presence") has no MRI in its id; we skip it here
// and expose it separately via readSelf().
function scrape(): Map<string, Status> {
  const map = new Map<string, Status>();
  const nodes = document.querySelectorAll<HTMLElement>('[id^="presence-pill-8:"]');
  for (const el of nodes) {
    const mri = el.id.slice("presence-pill-".length);
    if (!mri) continue;
    map.set(mri, statusOfBadge(el));
  }
  return map;
}

function readSelf(): Status {
  const el = document.querySelector<HTMLElement>('[data-tid="me-control-avatar-presence"]');
  if (!el) return "Unknown";
  return statusOfBadge(el);
}

// Sticky cache: Teams recycles a person's badge the moment they scroll out of
// its viewport, so a scrape that no longer sees an MRI does NOT mean "went
// Unknown" — it means "not on screen right now". We keep the last known status
// and only overwrite it when a fresh badge reports a (different) one. This stops
// the ring flickering on/off as Teams re-renders its own lists.
const cache = new Map<string, Status>();
let selfStatus: Status = "Unknown";
const subs = new Set<() => void>();
let unsub: (() => void) | null = null;
let poll: ReturnType<typeof setInterval> | 0 = 0;

// Re-scrape; merge into the sticky cache. Returns true if anything changed.
function refresh(): void {
  let changed = false;
  for (const [mri, st] of scrape()) {
    if (cache.get(mri) !== st) { cache.set(mri, st); changed = true; }
  }
  const self = readSelf();
  if (self !== "Unknown" && self !== selfStatus) { selfStatus = self; changed = true; }
  if (changed) for (const f of subs) f();
}

// Subscribe to presence changes. Lazily wires one MutationObserver (shared with
// live refresh) plus a slow poll, since Teams can update a badge in place
// without a childList mutation the observer would catch. Returns an unsubscribe.
export function onPresence(cb: () => void): () => void {
  subs.add(cb);
  if (!unsub) {
    refresh();
    unsub = onTeamsChange(refresh);
    poll = setInterval(refresh, 5000);
  }
  return () => {
    subs.delete(cb);
    if (!subs.size && unsub) {
      unsub(); unsub = null;
      if (poll) { clearInterval(poll); poll = 0; }
    }
  };
}

// Live source: the injector taps Teams' own trouter presence socket (in its web
// worker, reachable only over CDP) and pushes {mri, availability} here. The
// availability strings Teams sends ("Available", "Busy", "Away", "BeRightBack",
// "DoNotDisturb", "Offline") are exactly our Status values, so no mapping is
// needed; anything unrecognised is ignored (keeps the last known status). This
// covers people the DOM never painted a badge for — the scrape stays as a
// fallback for whoever the socket hasn't reported yet. The global is installed
// here so it exists before the injector's first push; a push for an unchanged
// status is a no-op, so no spurious re-renders.
const WS_STATUS: Record<string, Status> = {
  Available: "Available",
  Away: "Away",
  BeRightBack: "BeRightBack",
  Busy: "Busy",
  DoNotDisturb: "DoNotDisturb",
  Offline: "Offline",
};
interface PresenceSink {
  map: Record<string, Status>;
  push: (mri: string, availability: string) => void;
}
declare global {
  interface Window { __tcPresence?: PresenceSink }
}
(() => {
  const sink: PresenceSink = {
    map: {},
    push(mri: string, availability: string): void {
      const st = WS_STATUS[availability];
      if (!st || !mri) return;
      sink.map[mri] = st;
      if (cache.get(mri) !== st) { cache.set(mri, st); for (const f of subs) f(); }
    },
  };
  // Keep any statuses the injector pushed before the bundle (re)loaded, and seed
  // the cache so they survive a hot reload without waiting for the next push.
  const prev = window.__tcPresence;
  if (prev && prev.map) for (const mri in prev.map) {
    const st = prev.map[mri]; sink.map[mri] = st; cache.set(mri, st);
  }
  window.__tcPresence = sink;
})();

// Current status for an MRI (or self when mri omitted / matches self).
export function statusOf(mri: string | undefined): Status {
  if (!mri) return "Unknown";
  // Own MRI: the me-control badge (selfStatus) is the freshest source.
  if (mri === myMri() && selfStatus !== "Unknown") return selfStatus;
  return cache.get(mri) || "Unknown";
}

export function selfPresence(): Status {
  return selfStatus;
}

// Optimistic self update after we changed our own status through Teams' menu;
// the next scrape of the me-control badge confirms or corrects it.
export function setSelfPresence(st: Status): void {
  if (st === selfStatus) return;
  selfStatus = st;
  for (const f of subs) f();
}

// Hook: subscribe a component to presence and get a stable reader. `tick` just
// forces a re-render whenever presence changes; `statusOf`/`selfPresence` read
// the fresh cache. Use once near the top of a tree and pass statuses down, or
// call per-avatar — both are cheap (one shared observer).
export function usePresence(): { statusOf: (mri: string | undefined) => Status; self: () => Status } {
  const [, setTick] = useState(0);
  useEffect(() => onPresence(() => setTick((n) => n + 1)), []);
  return { statusOf, self: selfPresence };
}

// Ring colour per status. Matches Teams' own palette closely.
export const STATUS_COLOR: Record<Status, string> = {
  Available: "#6bb700",
  Away: "#ffaa44",
  BeRightBack: "#ffaa44",
  Busy: "#c4314b",
  DoNotDisturb: "#c4314b",
  Offline: "#b0aeac",
  Unknown: "transparent",
};
