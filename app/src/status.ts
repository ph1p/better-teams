// Set the current user's presence by driving Teams' own profile menu, the same
// way send.ts drives its composer: open the me-control, open the status submenu,
// click the wanted radio item. The data-tids are locale-independent (observed
// 2026-11-19, Teams v2). If any step's element doesn't show up we close the menu
// again and report failure instead of leaving it open under the overlay.

import type { WriteResult } from "./types";

export type SettableStatus =
  | "Available"
  | "Busy"
  | "DoNotDisturb"
  | "BeRightBack"
  | "Away"
  | "Offline"
  | "Reset";

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
