// Raw Teams messages (IndexedDB replychains, chatsvc REST, CDL worker) -> Message.
import type { FileRef, Message, Reaction } from "../types";
import { myMri } from "./idb";
import { profile } from "./profiles";
import { allowedUrl } from "../services/http";
import { safeHref } from "../safeUrl";
import { arr, extOf, get, mriOf, obj, parsed, str, toMs, type Dict } from "./raw";
import { deletedHere, rememberRef } from "./state";
import { parseCards, type Card } from "../cards";
import { parseMentions } from "../mentions";

const SKIP_TYPES = /ThreadActivity|Control|Event\//i;

// A channel meeting posts its callStarted Event/Call as a thread root, the
// meeting chat as replies to it, and a callEnded Event/Call reply when it
// ends. Keep both (as short meeting lines): without the root every meeting
// thread renders as replies to a missing post, and the end marks it not live.
const CALL = /^Event\/Call$/i;
const isCallEnd = (content: string) => /<callEventType>\s*callEnded/i.test(content);
const keepCall = (type: string, id: string, root: string | null, content: string) =>
  CALL.test(type) && !!root && (id === root || isCallEnd(content));
export const skipType = (type: string, id: string, root: string | null, content: string) =>
  SKIP_TYPES.test(type) && !keepCall(type, id, root, content);
function fmtCallDuration(sec: number) {
  const m = Math.round(sec / 60);
  return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function asCallRoot(n: Message, raw: Record<string, unknown>): Message {
  if (!CALL.test(n.messageType)) return n;
  const html = str(raw.content);
  if (isCallEnd(html)) {
    const secs = [...html.matchAll(/<duration>(\d+)<\/duration>/g)].map((x) => Number(x[1]));
    const d = secs.length ? Math.max(...secs) : 0;
    return {
      ...n,
      call: "end",
      from: n.from || "Meeting",
      content: "<p>Meeting ended" + (d ? " · " + fmtCallDuration(d) : "") + "</p>",
    };
  }
  // CDL nests the meeting object; IDB/REST keep it as a JSON string in properties.meeting.
  const pm = parsed(get(raw.properties, "meeting"));
  const title =
    str(get(raw.meeting, "meetingTitle")) || str(get(pm, "meetingtitle")) || str(get(raw.properties, "meetingtitle"));
  const esc = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    ...n,
    call: "start",
    from: n.from || "Meeting",
    content: "<p>Meeting" + (esc ? ": <b>" + esc + "</b>" : " started") + "</p>",
  };
}

// The https site URL when it is on SharePoint Online, else "".
function sharePointSite(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".sharepoint.com") ? u.href.replace(/\/?$/, "/") : "";
  } catch {
    return "";
  }
}

// properties.files: a JSON string of Teams file chiclets. See docs/file-send-flow.md.
function parseFiles(raw: unknown): FileRef[] {
  if (!raw) return [];
  try {
    return arr(parsed(raw))
      .map((f): FileRef => {
        const info = obj(get(f, "fileInfo"));
        const ids = obj(get(f, "sharepointIds"));
        const name = str(get(f, "fileName")) || str(get(f, "title")) || "file";
        const ext = (str(get(f, "fileType")) || str(get(f, "type"))).toLowerCase() || extOf(name);
        const ref: FileRef = {
          name,
          url: safeHref(str(info.shareUrl) || str(info.fileUrl) || str(get(f, "objectUrl")) || str(get(f, "openUrl"))),
          ext,
          raw: f,
        };
        const pv = obj(get(f, "filePreview"));
        // Only AMS previews: they load with the page's cookies.
        const pvUrl = allowedUrl(str(pv.previewUrl))?.href;
        if (pvUrl)
          ref.preview = { url: pvUrl, width: Number(pv.previewWidth) || 0, height: Number(pv.previewHeight) || 0 };
        const site = sharePointSite(str(info.siteUrl) || str(ids.siteUrl) || str(get(f, "baseUrl")));
        const uniqueId = (str(ids.listItemUniqueId) || str(get(f, "itemid"))).replace(/[{}]/g, "");
        if (site && /^[0-9a-f-]{36}$/i.test(uniqueId)) {
          const q = "?UniqueId=" + encodeURIComponent(uniqueId);
          ref.embed = site + "_layouts/15/embed.aspx" + q;
          ref.download = site + "_layouts/15/download.aspx" + q;
        }
        return ref;
      })
      .filter((f) => f.name);
  } catch {
    return [];
  }
}

// Teams keeps "follow this post" (channels) in the same emotions list as the
// reactions. It is a subscription, not a reaction: never show it as one.
const NOT_REACTIONS = new Set(["follow"]);
const isReaction = (r: Reaction) => !!r.key && r.count > 0 && !NOT_REACTIONS.has(r.key);

function reactionsOf(m: Dict) {
  // Counts live in annotationsSummary.emotions ({key:count}); the per-user list
  // (needed to know if *I* reacted) lives in properties.emotions
  // ([{key, users:[{mri,...}]}]). Merge both into {key, count, mine}.
  const em = obj(get(m.annotationsSummary, "emotions"));
  const detail = parsed(get(m.properties, "emotions"));
  const me = myMri();
  const usersOf = (key: string) => {
    const row = Array.isArray(detail) ? detail.find((d) => get(d, "key") === key) : null;
    return arr(get(row, "users") || get(row, "mris"))
      .map((u) => str(get(u, "mri")) || str(get(u, "id")) || str(u))
      .filter(Boolean);
  };
  return Object.entries(em)
    .map(([k, v]): Reaction => {
      const users = usersOf(k);
      return { key: k, count: Number(v) || 0, mine: users.includes(me), users };
    })
    .filter(isReaction);
}

// A soft-deleted message stays visible (as an Undo stub) only while Teams holds
// undo state for it, or it was deleted from this overlay (see deletedHere).
export const hiddenDeleted = (m: Dict, n: Message) => n.deleted && !m.deletionInfo && !deletedHere.has(n.id);

// Bot cards ride in the Swift content or a cards list; only set when present.
function withCards(content: string, raw: unknown): { cards?: Card[] } {
  const cards = parseCards(content, raw);
  return cards.length ? { cards } : {};
}

// A minimal reply-chain context: a cached replychain row, or a synthesized one
// for a remote channel message (built from its rootMessageId).
export interface ChainCtx {
  replyChainId: unknown;
  originalArrivalTime: unknown;
}

function asImportance(v: unknown): Message["importance"] {
  return v === "high" || v === "urgent" ? v : "normal";
}

// Forward origin. IDB/REST carry properties.originalMessageContext (object or
// JSON string; ids under messageId/originalThreadId), CDL a
// forwardedMessageContext with original* names.
export function withForward(raw: unknown): { forwarded?: Message["forwarded"] } {
  const o = obj(parsed(raw));
  const senderMri = str(o.originalSender) || str(o.originalSenderMri);
  const threadId = str(o.originalThreadId);
  const messageId = String(o.messageId ?? o.originalMessageId ?? "");
  if (!senderMri && !threadId) return {};
  return {
    forwarded: {
      senderMri,
      sender: profile(senderMri).displayName || "",
      time: toMs(o.originalSentTime ?? o.originalArrivalTime),
      messageId,
      threadId,
    },
  };
}

function withMentions(raw: unknown): { mentions?: Message["mentions"] } {
  const mentions = parseMentions(raw);
  return mentions.length ? { mentions } : {};
}

export function normMessage(raw: unknown, rc: ChainCtx | null): Message {
  const m = obj(raw);
  const props = obj(m.properties);
  const fromMri = str(m.creator) || mriOf(m.from);
  // IDB messages use camelCase; chatsvc REST messages use lowercase keys.
  const time =
    toMs(m.originalArrivalTime ?? m.originalarrivaltime) ||
    toMs(m.composetime) ||
    toMs(m.clientArrivalTime ?? m.clientarrivaltime);
  const isRoot = !rc || String(m.id) === String(rc.replyChainId);
  const deletetime = Number(get(m.properties, "deletetime")) || 0;
  rememberRef(String(m.id), str(m.clientmessageid) || str(m.clientMessageId), time);
  return {
    id: String(m.id),
    rootId: rc ? String(rc.replyChainId) : String(m.id),
    rootTime: rc ? toMs(rc.originalArrivalTime) || time : time,
    isReply: !isRoot,
    from: str(m.imDisplayName) || str(m.imdisplayname) || profile(fromMri).displayName || "",
    fromMri,
    content: str(m.content),
    messageType: str(m.messageType) || str(m.messagetype),
    mine: m.isSentByCurrentUser === true || (!!fromMri && fromMri === myMri()),
    deleted: !!str(get(m.deletionInfo, "deletiontime")) || deletetime > 0,
    edited: Number(props.edittime) > 0,
    subject: str(props.subject),
    importance: asImportance(props.importance),
    reactions: reactionsOf(m),
    files: parseFiles(props.files),
    ...withCards(str(m.content), props.cards),
    ...withMentions(props.mentions),
    ...withForward(props.originalMessageContext),
    time,
  };
}

// Shared message ordering. Channels: by thread root time, root before replies,
// then message time. Chats: one flat timeline by message time.
export function sortMessages(msgs: Message[], channel: boolean) {
  msgs.sort(
    channel
      ? (a, b) => a.rootTime - b.rootTime || Number(a.isReply) - Number(b.isReply) || a.time - b.time
      : (a, b) => a.time - b.time,
  );
}

export function parseRemotePage(j: unknown, channel: boolean) {
  const byId = new Map<string, Message>();
  for (const raw of arr(get(j, "messages"))) {
    const m = obj(raw);
    if (m.content === undefined) continue;
    // chatsvc carries rootMessageId per message, so channels can thread the same
    // way cached replychains do. Build a minimal rc from it; chats ignore it.
    const root = channel ? String(m.rootMessageId || m.id) : null;
    if (skipType(str(m.messagetype), String(m.id), root, str(m.content))) continue;
    const rc: ChainCtx | null = root ? { replyChainId: root, originalArrivalTime: null } : null;
    const n = asCallRoot(normMessage(raw, rc), m);
    if (hiddenDeleted(m, n)) continue;
    byId.set(n.id, n);
  }
  const msgs = [...byId.values()];
  // Cluster replies under their root's time (the root message carries it).
  if (channel) {
    const rootTimeById = new Map<string, number>();
    for (const n of msgs) if (!n.isReply) rootTimeById.set(n.rootId, n.time);
    for (const n of msgs) n.rootTime = rootTimeById.get(n.rootId) ?? n.rootTime;
  }
  sortMessages(msgs, channel);
  return msgs;
}

// Teams' worker `Message` (ComponentsChatQueriesMessageListQuery) -> our Message.
export function normCdlMessage(raw: unknown, channel = false) {
  const m = obj(raw);
  const messageType = str(m.messageType);
  const id = String(m.id);
  if (m.content === undefined || skipType(messageType, id, channel ? str(m.parentMessageId) : null, str(m.content)))
    return null;
  const time = toMs(m.originalArrivalTime);
  const fromMri = str(get(m.fromUser, "mri")) || str(m.fromUserId) || mriOf(m.from);
  const deleted = Number(m.deleteTime) > 0;
  // Teams hides deleted messages unless it flags them to show as deleted.
  if (deleted && get(m.deletionInfo, "showMessageAsDeleted") !== true && !deletedHere.has(id)) return null;
  rememberRef(id, str(m.clientMessageId), time);
  // Channel posts carry their thread root as parentMessageId (a root points at
  // itself). Message ids are arrival times in ms, so a reply whose root is not
  // on this page still sorts under it.
  const parent = channel ? str(m.parentMessageId) : "";
  const isReply = !!parent && parent !== id;
  const me = myMri();
  const counts = new Map<string, number>();
  for (const e of arr(m.emotionsSummary)) counts.set(str(get(e, "key")), Number(get(e, "count")) || 0);
  const reactions = arr(m.emotions)
    .map((e): Reaction => {
      const key = str(get(e, "key"));
      const users = arr(get(e, "users"))
        .map((u) => str(get(u, "userId")) || str(get(u, "id")))
        .filter(Boolean);
      return {
        key,
        count: users.length || counts.get(key) || 0,
        mine: users.includes(me),
        users,
      };
    })
    .filter(isReaction);
  return asCallRoot(
    {
      id,
      rootId: isReply ? parent : id,
      rootTime: isReply ? Number(parent) || time : time,
      isReply,
      from: str(m.imDisplayName) || str(get(m.fromUser, "displayName")) || profile(fromMri).displayName || "",
      fromMri,
      content: str(m.content),
      messageType,
      mine: !!fromMri && fromMri === me,
      deleted,
      edited: Number(m.editTime) > 0,
      subject: str(m.subject),
      importance: asImportance(str(m.importance).toLowerCase()),
      reactions,
      files: parseFiles(m.files),
      ...withCards(str(m.content), m.cards),
      ...withMentions(m.mentions),
      ...withForward(m.forwardedMessageContext),
      time,
    },
    m,
  );
}
