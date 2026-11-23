// "Update available" notice. At most once a day the overlay asks GitHub for
// the latest release tag and compares it with this build's version. It is the
// only request that does not go to Teams' own backend, so it can be turned off
// in Settings. A blocked or failed request (Teams' CSP, offline) shows nothing.

import { useSyncExternalStore } from "react";
import { read, write } from "./ui/lib/prefs";

const API = "https://api.github.com/repos/ph1p/better-teams/releases/latest";
const DAY = 24 * 60 * 60 * 1000;

/** What to paste into Terminal to update an installed release. */
export const UPDATE_CMD = "~/.better-teams/better-teams update";
export const releaseUrl = (version: string): string => `https://github.com/ph1p/better-teams/releases/tag/v${version}`;

interface Seen {
  at: number;
  tag: string;
}

/** True when version a ("v1.2.3" / "1.2.3") is newer than b. Non-release builds never compare. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

let latest: string | null = null;
const subs = new Set<() => void>();
const emit = (v: string | null): void => {
  if (v === latest) return;
  latest = v;
  for (const f of subs) f();
};

export const updateCheckOn = (): boolean => read("updateCheck", true);

/** Result of a check: a newer version, up to date, or GitHub not reachable. */
export type UpdateResult = { kind: "newer"; version: string } | { kind: "current" } | { kind: "failed" };

export function setUpdateCheck(on: boolean): void {
  write("updateCheck", on);
  if (on) void checkForUpdate();
  else emit(null);
}

async function fetchTag(): Promise<string | null> {
  try {
    const r = await fetch(API, {
      headers: { Accept: "application/vnd.github+json" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!r.ok) return null;
    const j: unknown = await r.json();
    const tag = typeof j === "object" && j !== null ? (j as { tag_name?: unknown }).tag_name : null;
    return typeof tag === "string" ? tag : null;
  } catch {
    return null;
  }
}

/**
 * Refresh the latest-release tag if the cached one is a day old, then publish it. `force` (the
 * "Check now" button) asks GitHub right away, even with the daily check turned off.
 */
export async function checkForUpdate(force = false, now = Date.now()): Promise<UpdateResult | null> {
  if (!force && !updateCheckOn()) return null;
  const seen = read<Seen | null>("latestRelease", null);
  let tag = seen?.tag ?? "";
  let failed = false;
  if (force || !seen || now - seen.at > DAY) {
    // A failed request also counts as a check, so a blocked fetch isn't retried on every load.
    const fresh = await fetchTag();
    failed = fresh === null;
    tag = fresh ?? tag;
    write<Seen>("latestRelease", { at: now, tag });
  }
  if (!force && !updateCheckOn()) return null;
  const newer = isNewer(tag, __VERSION__) ? tag.replace(/^v/, "") : null;
  emit(newer);
  if (newer) return { kind: "newer", version: newer };
  return failed ? { kind: "failed" } : { kind: "current" };
}

const subscribe = (f: () => void): (() => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

/** The newer release's version ("1.2.0"), or null. */
export const useUpdate = (): string | null => useSyncExternalStore(subscribe, () => latest);
