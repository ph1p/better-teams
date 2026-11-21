// Set the current user's presence. Preferred path: the same GraphQL mutation
// Teams' status menu posts to its web worker (services/presence.ts via cdl.ts),
// which works in prod. If the worker channel isn't ready or the call fails,
// drive Teams' own profile menu, the same way send.ts drives its composer: open the me-control, open the status submenu,
// click the wanted radio item. The data-tids are locale-independent (observed
// 2026-11-19, Teams v2). If any step's element doesn't show up we close the menu
// again and report failure instead of leaving it open under the overlay.

import type { WriteResult } from "./types";
import { presence } from "./services";

export type SettableStatus = "Available" | "Busy" | "DoNotDisturb" | "BeRightBack" | "Away" | "Offline" | "Reset";

const ITEM: Record<SettableStatus, string> = {
  Available: "me_control_presence_availability_available",
  Busy: "me_control_presence_availability_busy",
  DoNotDisturb: "me_control_presence_availability_do_not_disturb",
  BeRightBack: "me_control_presence_availability_be_right_back",
  Away: "me_control_presence_availability_appear_away",
  Offline: "me_control_presence_availability_appear_offline",
  Reset: "set-availability-reset-status",
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const q = (tid: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-tid="${tid}"]`);

async function waitTid(tid: string, ms = 2000): Promise<HTMLElement | null> {
  for (let t = 0; t < ms; t += 80) {
    const el = q(tid);
    if (el) return el;
    await sleep(80);
  }
  return q(tid);
}

// Fluent menus close on Escape at the focused element, one level per press.
async function closeMenus(): Promise<void> {
  for (let i = 0; i < 3 && q("me-control-menu-dialog"); i++) {
    (document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }),
    );
    await sleep(150);
  }
}

let busy = false;

export async function setMyStatus(status: SettableStatus): Promise<WriteResult> {
  const r = await presence.setAvailability(status === "Reset" ? null : status);
  if (r.ok) return { ok: true, via: "api" };
  return viaMenu(status);
}

async function viaMenu(status: SettableStatus): Promise<WriteResult> {
  if (busy) return { ok: false, reason: "busy" };
  busy = true;
  try {
    if (!q("me-control-menu-dialog")) {
      const trigger = q("me-control-avatar-trigger");
      if (!trigger) return { ok: false, reason: "Teams profile button not found" };
      trigger.click();
    }
    const sub = await waitTid("set-presence-status-menu-item");
    if (!sub) return { ok: false, reason: "Teams profile menu didn't open" };
    sub.click();
    const item = await waitTid(ITEM[status]);
    if (!item) return { ok: false, reason: "Teams status menu didn't open" };
    item.click();
    await sleep(200);
    return { ok: true, via: "native-menu" };
  } finally {
    await closeMenus();
    busy = false;
  }
}

// --- Status message ("custom status") ----------------------------------------
// API only (Teams' worker mutation): Teams' status-message dialog is a rich
// editor, too brittle to drive through the DOM.

export type NoteExpiry = "never" | "1h" | "4h" | "today" | "week";

const EXPIRY: Record<NoteExpiry, presence.Expiry> = {
  never: "Never",
  "1h": "OneHour",
  "4h": "FourHours",
  today: "Today",
  week: "ThisWeek",
};

// Local estimate of when the note lapses, only for myNote(); the server
// computes the real one from the enum.
function expiryDate(e: NoteExpiry): Date | undefined {
  const d = new Date();
  if (e === "1h") return new Date(d.getTime() + 3_600_000);
  if (e === "4h") return new Date(d.getTime() + 4 * 3_600_000);
  if (e === "today" || e === "week") {
    if (e === "week") d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); // to Sunday
    d.setHours(23, 59, 59, 999);
    return d;
  }
  return undefined;
}

export interface MyNote {
  text: string;
  until?: number;
}
let lastNote: MyNote | null = null;

/** The note we last set from the overlay (Teams' own value isn't read yet). */
export function myNote(): MyNote | null {
  if (lastNote && lastNote.until && lastNote.until < Date.now()) lastNote = null;
  return lastNote;
}

export async function setMyNote(text: string, expiry: NoteExpiry, pinned: boolean): Promise<WriteResult> {
  const r = await presence.setStatusNote(text, EXPIRY[expiry], pinned);
  if (!r.ok) return { ok: false, reason: r.reason };
  lastNote = text.trim() ? { text: text.trim(), until: expiryDate(expiry)?.getTime() } : null;
  return { ok: true, via: "api" };
}
