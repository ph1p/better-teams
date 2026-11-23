// Mock of src/services/presence.ts: presence lives in the store, which drifts
// colleagues' states over time. Setting my own state updates it directly.
import type { CdlRes } from "../../services/cdl";
import type { Availability, Expiry, PresenceEvent } from "../../services/presence";
import { ME, PEOPLE } from "../fixtures";
import { onPresence, presence, setPresence } from "../store";

export async function setAvailability(availability: Availability | null, _expiry?: Expiry): Promise<CdlRes<true>> {
  setPresence(ME, availability ?? "Available");
  return { ok: true, data: true };
}

export async function setStatusNote(_text: string, _expiry: Expiry, _pinned: boolean): Promise<CdlRes<true>> {
  return { ok: true, data: true };
}

const NOTES: Record<string, string> = {
  [PEOPLE[1].mri]: "&lt;p&gt;Mittag – bis 13:30&lt;/p&gt;<pinnednote></pinnednote>",
  [PEOPLE[4].mri]: "&lt;p&gt;Im Urlaub, Vertretung: Sofia&lt;/p&gt;",
};

export function watchPresence(userIds: string[], cb: (batch: PresenceEvent[]) => void): () => void {
  const want = new Set(userIds);
  const now = userIds.map((id) => ({
    id,
    availability: presence[id] || "PresenceUnknown",
    statusNote: NOTES[id] ? { message: NOTES[id], expiry: null } : null,
  }));
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
