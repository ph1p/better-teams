import type { WriteResult } from "../types";
import { chat, chatAud, chatsvc, token } from "../services";
import { toWrite, type Dict } from "./raw";
import { isChannelId, lastByConv } from "./state";

// Local read-pointer overrides. listChats reads the horizon from Teams' IndexedDB,
// which only catches up once the native client syncs the server change, so the
// next poll would flip a just-read chat back to unread. conversationId ->
// horizon ms we wrote, plus the IDB horizon seen when we first applied it; the
// override is dropped once IDB moves off that value (synced, or changed natively).
const horizonOverride = new Map<string, { ms: number; base?: number }>();

export function effectiveHorizon(conversationId: string, idbHorizon: number) {
  const ov = horizonOverride.get(conversationId);
  if (!ov) return idbHorizon;
  if (ov.base === undefined) ov.base = idbHorizon;
  else if (idbHorizon !== ov.base) {
    horizonOverride.delete(conversationId);
    return idbHorizon;
  }
  return ov.ms;
}

// Teams' "Mark as unread" sets only the bookmark property
// consumptionHorizonBookmark = "<msgTime-1>;<setAtMs>;<clientMsgId>" and leaves
// the horizon alone; "Mark as read" resets it to "0;<setAtMs>;0". So a chat is
// marked unread when field 0 is set and the bookmark is newer than the horizon
// write (field 1 of each); a later native read moves the horizon past it.
// Seen live on 48:notes, 2026-11-19.
function isMarkedUnread(props: Dict) {
  const bm = String(props.consumptionHorizonBookmark ?? "").split(";");
  if (!(Number(bm[0]) > 0)) return false;
  const chSetAt = Number(String(props.consumptionhorizon ?? "").split(";")[1]) || 0;
  return (Number(bm[1]) || 0) > chSetAt;
}

// Local marked-unread overrides: what we last set, plus the IDB bookmark seen
// when first applied; dropped once IDB moves off that value (worker synced).
const markOverride = new Map<string, { marked: boolean; base?: string }>();

export function effectiveMarked(conversationId: string, props: Dict) {
  const idb = isMarkedUnread(props);
  const ov = markOverride.get(conversationId);
  if (!ov) return idb;
  const bm = String(props.consumptionHorizonBookmark ?? "");
  if (ov.base === undefined) ov.base = bm;
  else if (bm !== ov.base) {
    markOverride.delete(conversationId);
    return idb;
  }
  return ov.marked;
}

// Local hide overrides: what we last set, held until Teams' IndexedDB agrees
// (the worker writes it a moment after the mutation answers).
const hiddenOverride = new Map<string, boolean>();

export function effectiveHidden(conversationId: string, idbHidden: boolean) {
  const ov = hiddenOverride.get(conversationId);
  if (ov === undefined) return idbHidden;
  if (ov === idbHidden) hiddenOverride.delete(conversationId);
  return ov;
}

// Syncs to all clients. Chats only.
export async function setChatHidden(conversationId: string, hidden: boolean): Promise<WriteResult> {
  if (isChannelId(conversationId)) return { ok: false, reason: "channels cannot be hidden" };
  const r = await chat.setChatHidden(conversationId, hidden);
  if (!r.ok) return r;
  hiddenOverride.set(conversationId, hidden);
  return { ok: true, via: "cdl" };
}

// PUT one conversation property through chatsvc, same ic3 bearer as send.
async function putConversationProperty(conversationId: string, name: string, value: string) {
  return toWrite(await chatsvc.putConversationProperty(conversationId, name, value));
}

// Move a conversation's read pointer: PUT consumptionhorizon "<msgId>;<ms>;<msgId>"
// (message ids are arrival ms), plus consumptionHorizonBookmark "0;<ms>;0", the
// marker Teams' own mark-as-unread sets. Verified live: both return 200 and the
// IDB row updates within a second. chatsvc only moves consumptionhorizon forward
// (a backward PUT returns 200 but is ignored), so mark-unread lands only in the
// bookmark and Teams' own isRead stays true; the overlay keeps it via the override.
// Real server write that syncs to all the user's devices; nothing is sent/deleted.
async function writeHorizon(conversationId: string, v: number) {
  const a = await putConversationProperty(conversationId, "consumptionhorizon", `${v};${v};${v}`);
  if (!a.ok) return a;
  return putConversationProperty(conversationId, "consumptionHorizonBookmark", `0;${v};0`);
}

// With no captured token yet, the write is queued (latest pointer per chat wins)
// and flushed by flushPendingHorizons() on the next chat-list poll that has one.
// Setting the pointer is idempotent, so a late write is safe.
const pendingHorizon = new Map<string, number>();

async function setConsumptionHorizon(conversationId: string, ms: number): Promise<WriteResult> {
  const v = Math.round(ms);
  if (!token(chatAud())) {
    pendingHorizon.set(conversationId, v);
    horizonOverride.set(conversationId, { ms: v });
    return { ok: true, via: "queued" };
  }
  pendingHorizon.delete(conversationId);
  const res = await writeHorizon(conversationId, v);
  if (res.ok) horizonOverride.set(conversationId, { ms: v });
  return res;
}

export async function flushPendingHorizons() {
  if (!pendingHorizon.size || !token(chatAud())) return;
  // Snapshot: the loop may re-queue an id it just took out.
  for (const [id, v] of Array.from(pendingHorizon)) {
    pendingHorizon.delete(id);
    const res = await writeHorizon(id, v);
    // Re-queue only transient failures (network, token gone, 5xx); a 4xx would
    // fail forever. Skip if a newer write for this chat was queued meanwhile.
    const transient =
      !res.ok && (res.reason === "fetch-failed" || res.reason === "no-token" || res.reason.startsWith("http-5"));
    if (transient && !pendingHorizon.has(id)) pendingHorizon.set(id, v);
    else if (!res.ok) horizonOverride.delete(id);
  }
}

// Mark read: push the pointer just past the newest message (default: now).
// Through Teams' worker when the chat's newest message is known (as Teams' own
// "Mark as read"); otherwise, or on failure, the chatsvc property PUT.
export async function markRead(conversationId: string, lastMessageMs?: number): Promise<WriteResult> {
  const ms = lastMessageMs ? lastMessageMs + 1 : Date.now();
  const last = lastByConv.get(conversationId);
  if (last) {
    const r = isChannelId(conversationId)
      ? await chat.markChannelRead(conversationId, last)
      : await chat.markRead(conversationId, last);
    if (r.ok) {
      pendingHorizon.delete(conversationId);
      horizonOverride.set(conversationId, { ms: Math.max(ms, last.time + 1) });
      markOverride.set(conversationId, { marked: false });
      return { ok: true, via: "cdl" };
    }
  }
  // The REST fallback moves only the horizon, not Teams' unread bookmark.
  const res = await setConsumptionHorizon(conversationId, ms);
  if (res.ok) markOverride.set(conversationId, { marked: false });
  return res;
}

// Mark unread: pull the pointer to just before the newest message.
export async function markUnread(conversationId: string, lastMessageMs?: number): Promise<WriteResult> {
  const ms = (lastMessageMs || Date.now()) - 1000;
  const last = lastByConv.get(conversationId);
  if (last && !isChannelId(conversationId)) {
    const r = await chat.markUnread(conversationId, last);
    if (r.ok) {
      // Teams sets only the bookmark (see isMarkedUnread); hold it until IDB syncs.
      markOverride.set(conversationId, { marked: true });
      return { ok: true, via: "cdl" };
    }
  }
  return setConsumptionHorizon(conversationId, ms);
}
