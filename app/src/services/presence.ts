// Presence: set the signed-in user's own status and status note, through
// Teams' web worker with the same GraphQL mutations Teams' own me-control sends
// (cdl.ts; documents copied verbatim from Teams' bundle, Nov 2026). The worker
// authenticates and calls the presence service exactly as for Teams' UI, so this
// needs no captured token and works in prod.
//
// Reading others' presence: ComponentsComposeMessagePresenceBatchSubscription
// with `{userIds, source:"ups"}`, as Teams' avatars do. The worker answers with
// the current state (about 1 s) and then pushes every change.

import { cdl, cdlSubscribe, type CdlRes } from "./cdl";
import * as D from "./chatDocs";

export type Availability = "Available" | "Busy" | "DoNotDisturb" | "BeRightBack" | "Away" | "Offline";

/** Teams' note/presence expiry enum (me-control-set-status-message-menu-item-*). */
export type Expiry = "Never" | "Today" | "OneHour" | "TwoHours" | "FourHours" | "ThisWeek";

const ME_PRESENCE =
  "fragment DataViewSchemaCdlMePresenceFragment on Presence {id,availability,activity,isOutOfOffice,outOfOfficeMessage,forcedAvailabilityExpiryDate,workLocation {location,locationSource,approximateDetails {id,name,idType}},statusNote {message,publishTime,expiry},isFocus}";

const result = (name: string): string =>
  `fragment ${name} on PresenceResult {... on PresenceSuccess {__typename,presence {id,...DataViewSchemaCdlMePresenceFragment}},... on PresenceErrorGeneric {__typename,errorCode},... on PresenceErrorNetworkOffline {__typename,errorCode}}`;

const SET_PRESENCE = [
  "mutation DataViewSchemaCdlSetPresenceAvailabilityMutation($request:SetPresenceRequest) {setPresence(setPresenceRequest:$request) {...DataViewSchemaCdlSetPresenceAvailabilityFragment}}",
  result("DataViewSchemaCdlSetPresenceAvailabilityFragment"),
  ME_PRESENCE,
].join("\n");

const SET_NOTE = [
  "mutation DataViewSchemaCdlSetStatusNoteMutation($request:StatusNoteRequest) {setStatusNote(statusNoteRequest:$request) {...DataViewSchemaCdlSetStatusNoteFragment}}",
  result("DataViewSchemaCdlSetStatusNoteFragment"),
  ME_PRESENCE,
].join("\n");

type PresenceResult = { __typename?: string; errorCode?: string };

function outcome(r: CdlRes<Record<string, PresenceResult | null>>, field: string): CdlRes<true> {
  if (!r.ok) return r;
  const v = r.data[field];
  if (v && v.__typename && v.__typename !== "PresenceSuccess") {
    return { ok: false, reason: `${v.__typename}${v.errorCode ? ": " + v.errorCode : ""}` };
  }
  return { ok: true, data: true };
}

/**
 * Force an availability, or reset to automatic with `null` (Teams sends
 * `{request:null}` for "Reset status"). Mirrors Teams' setPresenceAvailability.
 */
export async function setAvailability(availability: Availability | null, expiry?: Expiry): Promise<CdlRes<true>> {
  const request = availability ? { availability, ...(expiry ? { expiry } : {}) } : null;
  const r = await cdl<Record<string, PresenceResult | null>>(
    "DataViewSchemaCdlSetPresenceAvailabilityMutation",
    SET_PRESENCE,
    { request },
    { callerInfo: "TeamsClient:setPresenceAvailability" },
  );
  return outcome(r, "setPresence");
}

/**
 * Set the status note ("custom status") as Teams' dialog does: the editor's
 * HTML (`<p>text</p>`) is HTML-escaped once more, plus a `<pinnednote>` marker
 * when "show when people message me" is on. Empty `text` clears the note.
 */
export async function setStatusNote(text: string, expiry: Expiry, pinned: boolean): Promise<CdlRes<true>> {
  const t = text.trim();
  const request = t
    ? { message: escapeHtml(`<p>${escapeHtml(t)}</p>`) + (pinned ? "<pinnednote></pinnednote>" : ""), expiry }
    : null;
  const r = await cdl<Record<string, PresenceResult | null>>("DataViewSchemaCdlSetStatusNoteMutation", SET_NOTE, {
    request,
  });
  return outcome(r, "setStatusNote");
}

// Same character set as lodash escape, which Teams uses here.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One entry of a presence push, as the worker reports it. */
export interface PresenceEvent {
  /** MRI, e.g. `8:orgid:<guid>`. */
  id: string;
  /** Teams availability: Available, AvailableIdle, Away, BeRightBack, Busy, BusyIdle, DoNotDisturb, Offline, PresenceUnknown, ... */
  availability: string;
  activity?: string | null;
  isOutOfOffice?: boolean | null;
}

/**
 * Follow the presence of `userIds` (MRIs): first the current state, then every
 * change. `cb` gets each batch the worker pushes. Returns stop().
 */
export function watchPresence(userIds: string[], cb: (batch: PresenceEvent[]) => void): () => void {
  return cdlSubscribe<{ presenceUpdateEventBatch?: unknown }>(
    "ComponentsComposeMessagePresenceBatchSubscription",
    D.PRESENCE_BATCH_SUB,
    { userIds, source: "ups" },
    (d) => {
      const list = Array.isArray(d.presenceUpdateEventBatch) ? d.presenceUpdateEventBatch : [];
      const ok = list.filter(
        (e): e is PresenceEvent => !!e && typeof e.id === "string" && typeof e.availability === "string",
      );
      if (ok.length) cb(ok);
    },
  );
}
