import { substrate } from "../services";
import { CURRENT_OID } from "./idb";

// ---------------------------------------------------------------------------
// Org-wide people search (for @mentions).
//
// Teams' powerbar @-picker hits the SubstrateSearch "suggestions" endpoint on
// substrate.office.com — a DIFFERENT origin and a DIFFERENT bearer than chatsvc
// (aud 66a88757-… / SubstrateSearch). services/substrate.ts owns the request.
// We replay the People EntityRequest from that same endpoint and map each hit to
// a PeopleHit the composer can turn into a native person mention.
// Request + field list verified against a live client (Nov 2026).

export interface PeopleHit {
  mri: string;
  displayName: string;
  email: string;
  jobTitle: string;
}

// Pull the first non-empty string field (case-insensitive) off a loose object.
function pick(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

// Walk the suggestions response and collect People entities. The shape varies by
// flight (ResultSets vs Groups vs flat EntitySets), so we scan defensively for
// any object that carries an MRI/DisplayName pair rather than assume one layout.
function collectPeople(root: unknown, out: PeopleHit[], seen: Set<string>): void {
  if (!root || typeof root !== "object") return;
  if (Array.isArray(root)) {
    for (const el of root) collectPeople(el, out, seen);
    return;
  }
  const o = root as Record<string, unknown>;
  const mri = pick(o, "MRI", "Mri", "mri", "ImAddress");
  const name = pick(o, "DisplayName", "displayName");
  if (mri && name && /^8:/.test(mri) && !seen.has(mri)) {
    seen.add(mri);
    out.push({
      mri,
      displayName: name,
      email: pick(o, "EmailAddress", "ImAddress", "UserPrincipalName"),
      jobTitle: pick(o, "JobTitle", "Department"),
    });
  }
  for (const key of Object.keys(o)) {
    const v = o[key];
    if (v && typeof v === "object") collectPeople(v, out, seen);
  }
}

// Search the org directory for people matching `query` (substrate REST).
// Returns [] (never throws) when nothing answers, so callers can fall back to
// local chat members. Teams' own chat composer only offers chat members
// (worker op searchUsersByConversation filters the roster locally, see
// docs/cdl-api.md); org-wide hits are an overlay extra.
export async function searchPeople(query: string, size = 8): Promise<PeopleHit[]> {
  const q = (query || "").trim();
  if (!q) return [];
  const r = await substrate.suggestPeople(q, size, CURRENT_OID);
  if (!r.ok) return [];
  const out: PeopleHit[] = [];
  collectPeople(r.data, out, new Set<string>());
  return out.slice(0, size);
}
