// Mock of src/services/presence.ts: presence lives in the store, which drifts
// colleagues' states over time. Setting my own state updates it directly.
import type { CdlRes } from "../../services/cdl";
import type { Availability, Expiry, PresenceEvent } from "../../services/presence";
import { ME } from "../fixtures";
import { onPresence, presence, setPresence } from "../store";

export async function setAvailability(availability: Availability | null, _expiry?: Expiry): Promise<CdlRes<true>> {
  setPresence(ME, availability ?? "Available");
  return { ok: true, data: true };
}

export async function setStatusNote(_text: string, _expiry: Expiry, _pinned: boolean): Promise<CdlRes<true>> {
  return { ok: true, data: true };
}

export function watchPresence(userIds: string[], cb: (batch: PresenceEvent[]) => void): () => void {
  const want = new Set(userIds);
  const now = userIds.map((id) => ({ id, availability: presence[id] || "PresenceUnknown" }));
  // Async, like the worker's first push.
  const t = setTimeout(() => cb(now), 0);
  const off = onPresence((id, availability) => {
    if (want.has(id)) cb([{ id, availability }]);
  });
  return () => {
    clearTimeout(t);
    off();
  };
}
