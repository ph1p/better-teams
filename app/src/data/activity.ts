// Teams' activity feed: mentions, reactions and replies aimed at me. Teams keeps
// it as one more conversation, "48:notifications" (threadtype
// streamofnotifications); each message carries `properties.activity`, which
// points at the source chat and message. IndexedDB holds it as an object, the
// chatsvc REST page as a JSON string: both are parsed.
import type { Activity, ActivityKind } from "../types";
import { chatsvc } from "../services";
import { getByPrefix, open } from "./idb";
import { arr, get, isObj, obj, parsed, str, toMs, type Dict } from "./raw";
import { effectiveHorizon, markRead } from "./readState";

export const FEED_ID = "48:notifications";
const LIMIT = 50;
const REMOTE_TTL = 30_000;
let remote: { at: number; rows: unknown[] } | null = null;

const KINDS: Record<string, ActivityKind> = {
  mention: "mention",
  mentionInChat: "mention",
  teamMention: "mention",
  channelMention: "mention",
  reactionInChat: "reaction",
  reaction: "reaction",
  reply: "reply",
  replyToReply: "reply",
};

function activityOf(m: Dict) {
  const a = parsed(get(m.properties, "activity"));
  return isObj(a) ? a : null;
}

function toActivity(raw: unknown, horizon: number): Activity | null {
  const m = obj(raw);
  const a = activityOf(m);
  if (!a) return null;
  const type = str(a.activityType);
  const time = toMs(a.activityTimestamp) || toMs(m.originalArrivalTime) || toMs(m.composetime);
  const threadId = str(a.sourceThreadId);
  if (!type || !threadId || !time) return null;
  const sourceMid = a.sourceMessageId ?? a.sourceReplyChainId;
  return {
    id: String(a.activityId ?? m.id ?? `${threadId}:${time}`),
    kind: KINDS[type] || "other",
    type,
    subtype: str(a.activitySubtype),
    time,
    threadId,
    messageId: sourceMid == null || sourceMid === 0 ? "" : String(sourceMid),
    actorMri: str(a.sourceUserId),
    actorName: str(a.sourceUserImDisplayName),
    preview: str(a.messagePreview),
    count: Number(a.count) || 1,
    unread: time > horizon,
  };
}

async function feedHorizon() {
  let idb = 0;
  try {
    const db = await open("conversation");
    const os = db.transaction("conversations").objectStore("conversations");
    // Keyed by id in every schema seen; anything else reads as "all unread".
    const row =
      os.keyPath === "id"
        ? await new Promise<unknown>((res) => {
            const r = os.get(FEED_ID);
            r.onsuccess = () => res(r.result);
            r.onerror = () => res(undefined);
          })
        : undefined;
    idb = toMs(String(get(get(row, "properties"), "consumptionhorizon") ?? "").split(";")[0]);
  } catch {
    // No conversation DB yet: everything counts as unread until it shows up.
  }
  return effectiveHorizon(FEED_ID, idb);
}

async function localRows() {
  const db = await open("replychain");
  const stores = [...db.objectStoreNames].filter((s) => s.startsWith("replychains"));
  const chains = (await Promise.all(stores.map((s) => getByPrefix(db, s, FEED_ID)))).flat();
  return chains.flatMap((rc) => Object.values(obj(get(rc, "messageMap"))));
}

async function remoteRows() {
  if (remote && Date.now() - remote.at < REMOTE_TTL) return remote.rows;
  const r = await chatsvc.getMessages(FEED_ID, LIMIT);
  if (!r.ok) return remote?.rows ?? [];
  remote = { at: Date.now(), rows: arr(get(r.data, "messages")) };
  return remote.rows;
}

export async function listActivity() {
  const horizon = await feedHorizon();
  let rows = await localRows().catch(() => [] as unknown[]);
  if (!rows.length) rows = await remoteRows();
  const byId = new Map<string, Activity>();
  for (const raw of rows) {
    const a = toActivity(raw, horizon);
    if (a && (!byId.has(a.id) || byId.get(a.id)!.time < a.time)) byId.set(a.id, a);
  }
  return [...byId.values()].sort((x, y) => y.time - x.time).slice(0, LIMIT);
}

export function markActivityRead(newest: number) {
  return markRead(FEED_ID, newest);
}
