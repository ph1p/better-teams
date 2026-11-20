// Read/write layer for Teams Calm.
//
// Teams v2 keeps every chat, message and profile in IndexedDB, synced live by
// its own background worker. We read that same local store directly — no auth
// tokens, no network, no decryption. This is the robust way to get exactly the
// data Teams renders: when Teams syncs, our data updates too.
//
// Stores used (database names contain ":<name>-manager:" or ":<name>:"):
//   conversation-manager  -> "conversations"            (chat/channel list + lastMessage)
//   replychain-manager    -> "replychains*"             (messages, inside messageMap)
//   profiles              -> "profiles"                 (mri -> displayName, imageUri)
//
// Schema notes (verified against a live client, Nov 2026):
// - Messages live in "replychains" AND/OR "replychains-2"; Teams migrates
//   between them and drops the old store on reload. Read every store whose name
//   starts with "replychains", by the [conversationId, …] index when present.
// - originalArrivalTime / latestDeliveryTime are epoch-ms NUMBERS, not strings.
// - Sender mri is message.creator ("8:orgid:<oid>").
// - Only chats Teams has opened at least once have messages cached locally.
//
// Teams' IndexedDB rows and chatsvc REST payloads are untyped external data.
// They enter this module as `unknown` and are narrowed through the small typed
// accessors below (`str`, `num`, `obj`, `arr`, `get`), so nothing outside this
// file ever touches an `any`.

import type { Chat, ChatKind, FileRef, Message, Profile, Quote, Reaction, WriteResult } from "./types";
import { buildMentionContent, type MentionPick } from "./mentions";
import { buildQuoteHtml } from "./quote";
import { chat, chatsvc, substrate, region, token, type Res } from "./services";

// Service-layer result -> the UI's WriteResult.
const toWrite = (r: Res): WriteResult => (r.ok ? { ok: true } : { ok: false, reason: r.reason });

// --- Untyped-data accessors -----------------------------------------------
// Narrow arbitrary external data at the boundary. Each returns a typed value or
// a safe default; callers never see `any`.

type Dict = Record<string, unknown>;

const isObj = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Dict => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** Read one property off a possibly-non-object value. */
const get = (v: unknown, key: string): unknown => (isObj(v) ? v[key] : undefined);

const toMs = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v);
  const n = Number(s);
  return Number.isFinite(n) ? n : Date.parse(s) || 0;
};

// "https://…/contacts/8:orgid:<oid>" or "8:orgid:<oid>" -> "8:orgid:<oid>"
const mriOf = (s: unknown): string => (String(s ?? "").match(/\d+:[^/]+$/) || [""])[0];

// --- IndexedDB plumbing ----------------------------------------------------

const DB_CACHE: Record<string, IDBDatabase> = {};

async function findDb(fragment: string): Promise<string | undefined> {
  const names = (await indexedDB.databases())
    .map((d) => d.name)
    .filter((n): n is string => !!n);
  return (
    names.find((n) => n.includes(`:${fragment}-manager:`)) ||
    names.find((n) => n.includes(`:${fragment}:`))
  );
}

async function open(fragment: string): Promise<IDBDatabase> {
  const cached = DB_CACHE[fragment];
  if (cached) return cached;
  const name = await findDb(fragment);
  if (!name) throw new Error(`IndexedDB not found for "${fragment}"`);
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  // Teams upgrades its schema (e.g. replychains -> replychains-2) on reload;
  // drop our handle so the next call reopens the new version.
  db.onversionchange = () => {
    db.close();
    delete DB_CACHE[fragment];
  };
  db.onclose = () => delete DB_CACHE[fragment];
  DB_CACHE[fragment] = db;
  // Teams:<store>:react-web-client:<tenant>:<oid>:<locale>
  const parts = name.split(":");
  if (parts.length >= 3) CURRENT_OID = parts[parts.length - 2];
  return db;
}

export let CURRENT_OID = "";
export const myMri = (): string => (CURRENT_OID ? "8:orgid:" + CURRENT_OID : "");

// Teams profile photo URL. Captured shape (cookie-auth, no bearer):
//   /api/mt/<mtRegion>/beta/users/<my-guid>/profilepicturev2/<target-mri>
// mtRegion differs from the chatsvc region (e.g. emea vs de); the service
// layer records it off Teams' own traffic. Only org users (8:orgid:) have photos.
export function profilePhotoUrl(mri: string): string {
  if (!CURRENT_OID || !mri || mri.indexOf("8:orgid:") !== 0) return "";
  return (
    `/api/mt/${region("mt")}/beta/users/${CURRENT_OID}/profilepicturev2/` +
    encodeURIComponent(mri)
  );
}

function req(r: IDBRequest): Promise<unknown[]> {
  return new Promise((res) => {
    r.onsuccess = () => res((r.result as unknown[]) || []);
    r.onerror = () => res([]);
  });
}

function getAll(db: IDBDatabase, store: string, limit?: number): Promise<unknown[]> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  return req(db.transaction(store).objectStore(store).getAll(null, limit));
}

// All rows of `store` whose compound key/index starts with `prefix`.
function getByPrefix(db: IDBDatabase, store: string, prefix: string): Promise<unknown[]> {
  const os = db.transaction(store).objectStore(store);
  const range = IDBKeyRange.bound([prefix], [prefix, []]);
  for (const ix of os.indexNames) {
    const kp = os.index(ix).keyPath;
    if (Array.isArray(kp) && kp[0] === "conversationId") return req(os.index(ix).getAll(range));
  }
  if (Array.isArray(os.keyPath) && os.keyPath[0] === "conversationId") return req(os.getAll(range));
  return req(os.getAll()).then((rows) => rows.filter((r) => get(r, "conversationId") === prefix));
}

// --- Profiles: mri -> { displayName, imageUri, email } --------------------

let PROFILES: Record<string, Profile> = {};
export async function loadProfiles(): Promise<Record<string, Profile>> {
  try {
    const db = await open("profiles");
    const rows = await getAll(db, "profiles", 10000);
    const map: Record<string, Profile> = {};
    for (const row of rows) {
      const p = obj(row);
      const objectId = str(p.objectId);
      const key = str(p.mri) || (objectId ? "8:orgid:" + objectId : str(p.id));
      if (!key) continue;
      map[key] = {
        displayName: str(p.displayName) || [str(p.givenName), str(p.surname)].filter(Boolean).join(" ") || "",
        imageUri: str(p.imageUri),
        email: str(p.$$email) || str(p.userPrincipalName) || str(p.email),
        jobTitle: str(p.jobTitle) || str(p.title),
        department: str(p.department),
        officeLocation: str(p.officeLocation) || str(p.physicalDeliveryOfficeName),
      };
    }
    PROFILES = map;
  } catch {
    /* profiles optional */
  }
  return PROFILES;
}

const EMPTY_PROFILE: Profile = {
  displayName: "", imageUri: "", email: "", jobTitle: "", department: "", officeLocation: "",
};
export function profile(mri: string): Profile {
  return PROFILES[mri] || EMPTY_PROFILE;
}

// --- Chats ----------------------------------------------------------------

// Teams conversation types we show, mapped to our sections.
const KIND: Record<string, ChatKind> = {
  Chat: "chat", Meeting: "meeting", Topic: "channel", StreamOfNotes: "notes",
};

const firstName = (n: string): string => n.split(/[\s,]+/)[0];

function chatTitle(c: Dict, kind: ChatKind, others: string[]): string {
  const tp = obj(c.threadProperties);
  if (kind === "notes") return "Notes";
  if (kind === "channel") {
    // The General channel often has no topic of its own.
    // Private/shared channels are their own space: spaceThreadTopic is their name.
    if (str(c.type) === "Space" && str(c.id) !== str(c.teamId)) return str(tp.spaceThreadTopic) || "Channel";
    return str(tp.topic) || str(tp.topicThreadTopic) || "General";
  }
  if (str(tp.topic)) return str(tp.topic);
  const names = others.map((m) => profile(m).displayName).filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length > 1) {
    const shown = names.slice(0, 3).map(firstName).join(", ");
    return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
  }
  const lm = obj(c.lastMessage);
  if (str(lm.imdisplayname) && mriOf(lm.from) !== myMri()) return str(lm.imdisplayname);
  return kind === "meeting" ? "Meeting chat" : "(Chat)";
}

// Teams' real favorites live in the conversation-folder-manager DB, in a folder
// with folderType "Favorites" (pinned chats were migrated into it). The old
// properties.favorite flag on a conversation is only set for channels, not
// chats, so reading it alone made the overlay disagree with Teams. Returns a Set
// of favorited conversation ids; empty on any failure (favorites are optional).
async function favoriteIds(): Promise<Set<string>> {
  try {
    const db = await open("conversation-folder");
    const folders = await getAll(db, "folders", 200);
    const fav = folders.map(obj).find((f) => f.folderType === "Favorites" && !f.isDeleted);
    const ids = new Set<string>();
    for (const c of arr(fav && fav.conversations)) {
      const id = str(get(c, "id"));
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return new Set<string>();
  }
}

// Running call: Teams keeps "awareness_conversationLiveState:<rootId>" in the
// thread properties (JSON: status, expiration in s). A call whose end event got
// lost stays "Active" but expires, so expiration is checked too.
function liveCallRoot(tp: Dict): string {
  const now = Date.now();
  for (const [k, v] of Object.entries(tp)) {
    if (!k.startsWith("awareness_conversationLiveState:")) continue;
    let j: Dict;
    try { j = obj(typeof v === "string" ? JSON.parse(v) : v); } catch { continue; }
    if (j.status === "Active" && Number(j.expiration) * 1000 > now) return k.slice(k.indexOf(":") + 1);
  }
  return "";
}

export async function listChats(): Promise<Chat[]> {
  void flushPendingHorizons();
  const db = await open("conversation");
  const rows = (await getAll(db, "conversations", 10000)).map(obj);
  const favs = await favoriteIds();
  const spaces: Record<string, Dict> = {};
  for (const c of rows) if (c.type === "Space") spaces[str(c.id)] = c;
  const me = myMri();

  const chats: Chat[] = [];
  for (const c of rows) {
    // Channels stored as "Space" rows: a team's General channel is the team's
    // own row (id === teamId, topic "General"); private/shared channels are
    // their own space (id !== teamId, threadSubType PrivateChannel/…), named by
    // spaceThreadTopic. "lwgChannelLie-*" rows are Teams' optimistic
    // placeholders for a channel being created; the real row follows.
    const tp = obj(c.threadProperties);
    const isSpaceChannel = c.type === "Space" && !!c.id && !!c.teamId && !obj(c.properties).isLie;
    const kind = isSpaceChannel ? "channel" : KIND[str(c.type)];
    if (!kind || !c.id) continue;
    if (tp.isdeleted === "true" || tp.isdeleted === true) continue;
    // A brand-new channel has no message yet; list it from its creation time.
    if (!c.lastMessage && kind !== "channel") continue;
    const props = obj(c.properties);
    const lm = obj(c.lastMessage);
    const time = toMs(c.lastMessageTimeUtc) || toMs(lm.originalarrivaltime) || toMs(lm.composetime)
      || (kind === "channel" ? toMs(tp.createdat) : 0);
    if (!time) continue;
    const lmTime = toMs(lm.originalarrivaltime) || time;
    if (lm.id) lastByConv.set(str(c.id), { id: String(lm.id), clientMessageId: str(lm.clientmessageid), time: lmTime });

    const others = arr(c.members)
      .map((m) => str(get(m, "id")) || str(get(m, "mri")))
      .filter((id) => id && id !== me);
    const teamKey = str(c.teamId) || str(tp.spaceId);
    const team = kind === "channel" ? spaces[teamKey] : undefined;
    const teamTp = obj(team && team.threadProperties);
    const teamName = team ? str(teamTp.spaceThreadTopic) || str(teamTp.topic) : "";
    const lastFromMe = mriOf(lm.from) === me;
    // Read pointer = consumptionhorizon field 0 ("<msgId>;<ms>;<id>"). Checked
    // against Teams' own threadProperties.isRead: matches on all 250 chats, while
    // also honouring consumptionHorizonBookmark does not.
    const horizon = effectiveHorizon(str(c.id), toMs(String(props.consumptionhorizon ?? "").split(";")[0]));
    // A thread we left (lastleaveat after lastjoinat) keeps a stale horizon that
    // read writes can't move (we're no longer a member), so it would show unread
    // forever, even right after marking it read.
    const left = (Number(tp.lastleaveat) || 0) > (Number(tp.lastjoinat) || 0);
    // Hidden (Teams' "Hide"): the worker keeps the hide time in the user
    // property unpinnedTime; a newer message brings the chat back.
    const hiddenAt = Number(props.unpinnedTime) || 0;
    const hidden = effectiveHidden(str(c.id), hiddenAt > 0 && time <= hiddenAt);

    chats.push({
      ...(liveCallRoot(tp) ? { liveCall: liveCallRoot(tp) } : {}),
      id: str(c.id),
      kind,
      title: chatTitle(c, kind, others),
      team: teamName,
      isChannel: kind === "channel",
      // 1:1 chats get the other person's photo.
      avatarMri: kind === "chat" && others.length === 1 ? others[0] : "",
      // Other participants' MRIs — powers the "chats with this user" panel.
      members: others,
      favorite: favs.has(str(c.id)),
      pinned: props.ispinned === "true" || props.ispinned === true,
      hidden,
      time,
      unread: !left && (effectiveMarked(str(c.id), props) || (!lastFromMe && horizon > 0 && time > horizon)),
      last: {
        from: lastFromMe ? "You" : str(lm.imdisplayname),
        content: str(lm.content),
        type: str(lm.messagetype),
      },
    });
  }
  chats.sort((a, b) => b.time - a.time);
  return chats;
}

// --- Messages -------------------------------------------------------------

const SKIP_TYPES = /ThreadActivity|Control|Event\//i;

// A channel meeting posts its callStarted Event/Call as a thread root, the
// meeting chat as replies to it, and a callEnded Event/Call reply when it
// ends. Keep both (as short meeting lines): without the root every meeting
// thread renders as replies to a missing post, and the end marks it not live.
const CALL = /^Event\/Call$/i;
const isCallEnd = (content: string): boolean => /<callEventType>\s*callEnded/i.test(content);
const keepCall = (type: string, id: string, root: string | null, content: string): boolean =>
  CALL.test(type) && !!root && (id === root || isCallEnd(content));
const skipType = (type: string, id: string, root: string | null, content: string): boolean =>
  SKIP_TYPES.test(type) && !keepCall(type, id, root, content);
function fmtCallDuration(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${Math.max(1, m)} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
function asCallRoot(n: Message, raw: Record<string, unknown>): Message {
  if (!CALL.test(n.messageType)) return n;
  const html = str(raw.content);
  if (isCallEnd(html)) {
    const secs = [...html.matchAll(/<duration>(\d+)<\/duration>/g)].map((x) => Number(x[1]));
    const d = secs.length ? Math.max(...secs) : 0;
    return { ...n, call: "end", from: n.from || "Meeting", content: "<p>Meeting ended" + (d ? " · " + fmtCallDuration(d) : "") + "</p>" };
  }
  // CDL nests the meeting object; IDB/REST keep it as a JSON string in properties.meeting.
  let pm: unknown = get(raw.properties, "meeting");
  if (typeof pm === "string") { try { pm = JSON.parse(pm); } catch { pm = undefined; } }
  const title = str(get(raw.meeting, "meetingTitle")) || str(get(pm, "meetingtitle")) || str(get(raw.properties, "meetingtitle"));
  const esc = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return { ...n, call: "start", from: n.from || "Meeting", content: "<p>Meeting" + (esc ? ": <b>" + esc + "</b>" : " started") + "</p>" };
}

function parseFiles(raw: unknown): FileRef[] {
  if (!raw) return [];
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    return arr(parsed)
      .map((f): FileRef => {
        const info = obj(get(f, "fileInfo"));
        return {
          name: str(get(f, "fileName")) || str(get(f, "title")) || "file",
          url: str(info.shareUrl) || str(info.fileUrl) || str(get(f, "objectUrl")) || str(get(f, "openUrl")),
        };
      })
      .filter((f) => f.name);
  } catch {
    return [];
  }
}

// Teams custom reaction keys encode the emoji as a leading codepoint, e.g.
// "1f52d_telescope" or "1f44d". Decode that to the actual glyph; leave the six
// classic keys (like/heart/…) alone for the UI's own map.
function reactionGlyph(key: string): string {
  const m = /^([0-9a-f]{4,6})(?:_|$)/i.exec(key);
  if (m) {
    try { return String.fromCodePoint(parseInt(m[1], 16)); } catch { /* fall through */ }
  }
  return key;
}

function reactionsOf(m: Dict): Reaction[] {
  // Counts live in annotationsSummary.emotions ({key:count}); the per-user list
  // (needed to know if *I* reacted) lives in properties.emotions
  // ([{key, users:[{mri,...}]}]). Merge both into {key, glyph, count, mine}.
  const em = obj(get(m.annotationsSummary, "emotions"));
  let detail: unknown = get(m.properties, "emotions");
  if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { detail = null; } }
  const me = myMri();
  const mineOf = (key: string): boolean => {
    const row = Array.isArray(detail) ? detail.find((d) => get(d, "key") === key) : null;
    const users = arr(get(row, "users") || get(row, "mris"));
    return users.some((u) => (str(get(u, "mri")) || str(get(u, "id")) || u) === me);
  };
  return Object.entries(em)
    .map(([k, v]): Reaction => ({ key: k, glyph: reactionGlyph(k), count: Number(v) || 0, mine: mineOf(k) }))
    .filter((r) => r.count > 0);
}

// Teams only renders a "This message was deleted / Undo" stub for messages it
// still holds undo state for (IDB deletionInfo). Every other soft-deleted
// message is hidden entirely. Mirror that, plus keep stubs for messages deleted
// from this overlay in this session so their Undo stays reachable.
const deletedHere = new Set<string>();
const hiddenDeleted = (m: Dict, n: Message): boolean =>
  n.deleted && !m.deletionInfo && !deletedHere.has(n.id);

// A minimal reply-chain context: a cached replychain row, or a synthesized one
// for a remote channel message (built from its rootMessageId).
interface ChainCtx {
  replyChainId: unknown;
  originalArrivalTime: unknown;
}

function asImportance(v: unknown): Message["importance"] {
  return v === "high" || v === "urgent" ? v : "normal";
}

// messageId -> {clientMessageId, time} for every message we normalized: CDL
// edit/delete/read take these, while the UI only passes message ids. Bounded.
const msgRefs = new Map<string, { clientMessageId: string; time: number }>();
const MAX_REFS = 5000;

function rememberRef(id: string, clientMessageId: string, time: number): void {
  if (!id || !time) return;
  msgRefs.delete(id);
  msgRefs.set(id, { clientMessageId, time });
  if (msgRefs.size > MAX_REFS) msgRefs.delete(msgRefs.keys().next().value as string);
}

// Each chat's newest message, from the chat list: what Teams' mark read/unread key on.
const lastByConv = new Map<string, chat.MsgRef>();

// Channel posts carry reply-chain state the CDL layer does not model yet; they
// stay on the chatsvc REST path.
const isChannelId = (id: string): boolean => /@thread\.(tacv2|skype)$/.test(id);

function normMessage(raw: unknown, rc: ChainCtx | null): Message {
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
    time,
  };
}

interface ListOptions {
  channel?: boolean;
  limit?: number;
  remoteLimit?: number;
}

export async function listMessages(
  conversationId: string,
  { channel = false, limit = 300, remoteLimit = limit }: ListOptions = {}
): Promise<Message[] | null> {
  const db = await open("replychain");
  const stores = [...db.objectStoreNames].filter((s) => s.startsWith("replychains"));
  const chains = (await Promise.all(stores.map((s) => getByPrefix(db, s, conversationId)))).flat();

  const byId = new Map<string, Message & { _v: number }>();
  for (const rcRaw of chains) {
    const rc = obj(rcRaw) as unknown as ChainCtx;
    const messageMap = obj(get(rcRaw, "messageMap"));
    for (const raw of Object.values(messageMap)) {
      const m = obj(raw);
      if (m.content === undefined) continue;
      if (skipType(str(m.messageType), String(m.id), rc ? String(rc.replyChainId) : null, str(m.content))) continue;
      const n = asCallRoot(normMessage(raw, rc), m);
      if (hiddenDeleted(m, n)) continue;
      const prev = byId.get(n.id);
      const v = Number(m.version) || 0;
      // Same message in two stores during a migration: keep the newer version.
      if (!prev || v >= prev._v) byId.set(n.id, { ...n, _v: v });
    }
  }
  const msgs: Message[] = [...byId.values()].map(({ _v, ...m }) => (void _v, m));
  // Uncached chat: Teams never opened it natively, so no replychain is stored
  // locally. Fetch it from the same backend Teams uses, with Teams' own token.
  if (msgs.length === 0) {
    // Same query Teams' chat pane sends; the worker may hold the chat in memory.
    // Channels too: the worker answers them as one flat list, replies included.
    const fromWorker = await cdlFirstPage(conversationId, channel);
    if (fromWorker && fromWorker.length) return fromWorker.slice(-remoteLimit);
    const remote = await fetchRemoteMessages(conversationId, remoteLimit, channel);
    if (remote && remote.length) return remote;
    // remote === null means the backend couldn't be reached (no token yet, http
    // error, parse fail). Signal "unknown, keep trying" rather than "empty", so
    // the UI stays on its loading state and a later poll fills it, instead of
    // flashing "No messages cached" on a single transient miss.
    if (remote === null) return null;
    // remote === [] means the backend genuinely returned no messages: truly empty.
  }
  // Channels read like threads: each post followed by its replies.
  // Chats are one flat timeline.
  sortMessages(msgs, channel);
  return msgs.slice(-limit);
}

// Shared message ordering. Channels: by thread root time, root before replies,
// then message time. Chats: one flat timeline by message time.
function sortMessages(msgs: Message[], channel: boolean): void {
  msgs.sort(
    channel
      ? (a, b) => a.rootTime - b.rootTime || Number(a.isReply) - Number(b.isReply) || a.time - b.time
      : (a, b) => a.time - b.time
  );
}

// Uncached chats poll every few seconds but their IndexedDB stays empty, so
// cache the remote result briefly to avoid hammering chatsvc on every tick.
// Kept just under the UI poll interval (4s) so a new message shows within one
// tick instead of waiting out a long cache.
const REMOTE_TTL = 3500;
const remoteCache = new Map<string, { at: number; msgs: Message[] }>();

// Fetch messages for a conversation straight from chatsvc — the exact endpoint
// Teams itself calls — using Teams' own live token. Returns normalized messages,
// or null if no token is available or the request fails.
async function fetchRemoteMessages(
  conversationId: string,
  limit: number,
  channel = false
): Promise<Message[] | null> {
  const cached = remoteCache.get(conversationId);
  if (cached && Date.now() - cached.at < REMOTE_TTL) return cached.msgs;
  const r = await chatsvc.getMessages(conversationId, limit);
  if (!r.ok) return null;
  const j: unknown = r.data;
  const out = parseRemotePage(j, channel).slice(-limit);
  // Stash the backward-paging link so scroll-up can load older messages.
  backwardLinks.set(conversationId, str(get(get(j, "_metadata"), "backwardLink")) || null);
  remoteCache.set(conversationId, { at: Date.now(), msgs: out });
  return out;
}

// Turn one chatsvc page of raw messages into sorted, normalized messages.
function parseRemotePage(j: unknown, channel: boolean): Message[] {
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
// Chats only: flat timeline, every message its own root.
function normCdlMessage(raw: unknown, channel = false): Message | null {
  const m = obj(raw);
  const messageType = str(m.messageType);
  const id = String(m.id);
  if (m.content === undefined || skipType(messageType, id, channel ? str(m.parentMessageId) : null, str(m.content))) return null;
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
      const users = arr(get(e, "users"));
      return {
        key,
        glyph: reactionGlyph(key),
        count: users.length || counts.get(key) || 0,
        mine: users.some((u) => (str(get(u, "userId")) || str(get(u, "id"))) === me),
      };
    })
    .filter((r) => r.key && r.count > 0);
  return asCallRoot({
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
    time,
  }, m);
}

// conversationId -> worker cursor for the next older page (null: start of
// history). Set by the first CDL page, advanced by fetchOlderRemote.
const cdlCursors = new Map<string, string | null>();

// One CDL page, oldest first. null when the worker failed or holds nothing for
// the chat (uncached: it answers an empty page), so callers fall back to REST.
async function cdlPage(
  conversationId: string, cursor?: string, channel = false
): Promise<{ msgs: Message[]; older: string | null } | null> {
  const r = await chat.listMessages(conversationId, cursor);
  if (!r.ok) return null;
  const msgs = r.data.messages.map((m) => normCdlMessage(m, channel)).filter((n): n is Message => !!n);
  sortMessages(msgs, channel);
  return { msgs, older: r.data.older };
}

// First page of an uncached chat through Teams' worker. Keeps an existing
// cursor so a poll does not reset scroll-up paging.
async function cdlFirstPage(conversationId: string, channel = false): Promise<Message[] | null> {
  const p = await cdlPage(conversationId, undefined, channel);
  if (!p || (!p.msgs.length && !p.older)) return null;
  if (!cdlCursors.has(conversationId)) cdlCursors.set(conversationId, p.older);
  return p.msgs;
}

// conversationId -> chatsvc backwardLink URL for the next older page (or null at
// the start of history). Set by fetchRemoteMessages, advanced by fetchOlderRemote.
const backwardLinks = new Map<string, string | null>();

// Load the next older page: through Teams' worker when the chat was paged there,
// else by following the stored chatsvc backwardLink.
// Returns an array of older messages (may be empty at start of history), or null
// if there's no link yet or the request fails. Advances the link for the next call.
export async function fetchOlderRemote(conversationId: string, channel = false): Promise<Message[] | null> {
  // Scrolled up before the chat's priming finished: get a cursor first rather
  // than reporting "no history".
  if (!cdlCursors.has(conversationId) && !backwardLinks.has(conversationId)) await primeRemote(conversationId, channel);
  if (cdlCursors.has(conversationId)) {
    const cursor = cdlCursors.get(conversationId);
    if (!cursor) return null;
    const p = await cdlPage(conversationId, cursor, channel);
    // Transient failure: keep the cursor, report "nothing yet" so a later
    // scroll retries instead of marking the history as ended.
    if (!p) return [];
    cdlCursors.set(conversationId, p.older);
    return p.msgs;
  }
  const link = backwardLinks.get(conversationId);
  if (!link) return null;
  // backwardLink is an absolute teams.microsoft.com URL; the service layer
  // keeps same-origin links relative and refuses any other host.
  const r = await chatsvc.getMessagesByLink(link);
  if (!r.ok) return null;
  const j: unknown = r.data;
  // Advance (or clear) the link. A link that doesn't change, or no messages,
  // means we've reached the start of history.
  const next = str(get(get(j, "_metadata"), "backwardLink")) || null;
  backwardLinks.set(conversationId, next === link ? null : next);
  return parseRemotePage(j, channel);
}

// Fetch the first remote page purely to capture its paging cursor (worker
// cursor first, chatsvc backwardLink as fallback), so
// scroll-up pagination works even for chats whose recent messages came from the
// local IndexedDB cache (which carries no paging cursor). Returns the parsed page so
// the caller can merge any messages the cache was missing. Skips the work when
// a backward link is already known for this chat.
export function primeRemote(conversationId: string, channel = false): Promise<Message[] | null> {
  if (backwardLinks.has(conversationId) || cdlCursors.has(conversationId)) return Promise.resolve(null);
  // One priming per chat at a time (chat open and an early scroll-up race).
  let p = priming.get(conversationId);
  if (!p) {
    p = primeOnce(conversationId, channel).finally(() => priming.delete(conversationId));
    priming.set(conversationId, p);
  }
  return p;
}

const priming = new Map<string, Promise<Message[] | null>>();

async function primeOnce(conversationId: string, channel: boolean): Promise<Message[] | null> {
  const first = await cdlFirstPage(conversationId, channel);
  if (first) return first;
  const r = await chatsvc.getMessages(conversationId, 30);
  if (!r.ok) return null;
  const j: unknown = r.data;
  backwardLinks.set(conversationId, str(get(get(j, "_metadata"), "backwardLink")) || null);
  return parseRemotePage(j, channel);
}

// cdl's error when the worker channel isn't learned yet: nothing was sent, so
// falling back to REST is safe.
const NOT_READY = "Teams worker channel not ready";

// properties.mentions JSON (mentions.ts) -> Teams' MentionInput list.
function mentionInputs(json: string): chat.MentionInput[] {
  try {
    return arr(JSON.parse(json)).map((e) => ({
      itemId: String(get(e, "itemid") ?? ""),
      userId: str(get(e, "mri")),
      mentionType: str(get(e, "mentionType")) || "person",
      displayName: str(get(e, "displayName")),
    }));
  } catch {
    return [];
  }
}

// Send a text message through the exact chatsvc endpoint Teams itself POSTs to,
// with Teams' own live token. Mirrors the captured native-send body 1:1. Returns
// { ok, reason? }. Returns { ok:false, reason:"no-token" } when no bearer is
// available yet, so the caller can fall back to the native composer.
// `quote`, when given, is the message being quote-replied to:
// { id, from, text, fromMri }. It prepends a Skype Reply blockquote exactly as
// Teams' native quote-reply does, so the reply threads to that message.
export async function sendRemote(
  conversationId: string,
  text: string,
  quote: Quote | null,
  mentions: readonly MentionPick[] = [],
  /** Channel thread to reply in (the root message id). Ignored for chats. */
  rootId?: string
): Promise<WriteResult> {
  const body = (text || "").trim();
  if (!body) return { ok: false, reason: "empty" };
  // HTML-escape the body and splice in any @mention spans (native Teams format).
  const mc = buildMentionContent(body, mentions);
  // Native quote-reply: prepend the Skype Reply blockquote (captured format).
  const content = buildQuoteHtml(quote) + "<p>" + mc.html + "</p>";
  const clientMessageId = chat.newClientMessageId();
  const channel = isChannelId(conversationId);
  const reply = !!rootId && channel;
  // Chats, channel posts and thread replies all go through the CDL worker,
  // which holds its own tokens; native compose for a reply sets
  // convId=channel, replyChainId=root, sendFromChannel_ToBeRefactored.
  const r = await chat.sendMessage({
    convId: conversationId,
    content,
    clientMessageId,
    mentions: mentionInputs(mc.mentions),
    channel,
    ...(reply ? { replyChainId: rootId } : {}),
  });
  if (r.ok) {
    remoteCache.delete(conversationId);
    return { ok: true, via: "cdl" };
  }
  // Fall back only when the request never reached the worker; any later
  // failure may already have sent, and a retry would post twice.
  if (r.reason !== NOT_READY) return { ok: false, reason: r.reason };
  if (!token("ic3")) return { ok: false, reason: reply ? "no-token-thread" : "no-token" };
  // chatsvc addresses a channel thread as "<channelId>;messageid=<rootId>".
  const target = reply ? `${conversationId};messageid=${rootId}` : conversationId;
  const mri = myMri();
  const now = new Date().toISOString();
  const payload = {
    id: "-1",
    type: "Message",
    conversationid: conversationId,
    conversationLink: "blah/" + target,
    from: mri,
    fromUserId: mri,
    composetime: now,
    originalarrivaltime: now,
    content,
    messagetype: "RichText/Html",
    contenttype: "Text",
    imdisplayname: profile(mri).displayName || "",
    clientmessageid: clientMessageId,
    callId: "",
    state: 0,
    version: "0",
    amsreferences: [] as string[],
    properties: {
      importance: "",
      subject: "",
      title: "",
      cards: "[]",
      links: "[]",
      mentions: mc.mentions,
      onbehalfof: null,
      files: "[]",
      policyViolation: null,
      formatVariant: "TEAMS",
    },
    crossPostChannels: [] as string[],
  };
  const rest = await chatsvc.postMessage(target, payload);
  if (!rest.ok) return toWrite(rest);
  // Our cached view is now stale; drop it so the next poll re-fetches.
  remoteCache.delete(conversationId);
  return { ok: true, via: "endpoint" };
}

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

// Local read-pointer overrides. listChats reads the horizon from Teams' IndexedDB,
// which only catches up once the native client syncs the server change, so the
// next poll would flip a just-read chat back to unread. conversationId ->
// horizon ms we wrote, plus the IDB horizon seen when we first applied it; the
// override is dropped once IDB moves off that value (synced, or changed natively).
const horizonOverride = new Map<string, { ms: number; base?: number }>();

function effectiveHorizon(conversationId: string, idbHorizon: number): number {
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
function isMarkedUnread(props: Dict): boolean {
  const bm = String(props.consumptionHorizonBookmark ?? "").split(";");
  if (!(Number(bm[0]) > 0)) return false;
  const chSetAt = Number(String(props.consumptionhorizon ?? "").split(";")[1]) || 0;
  return (Number(bm[1]) || 0) > chSetAt;
}

// Local marked-unread overrides: what we last set, plus the IDB bookmark seen
// when first applied; dropped once IDB moves off that value (worker synced).
const markOverride = new Map<string, { marked: boolean; base?: string }>();

function effectiveMarked(conversationId: string, props: Dict): boolean {
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

function effectiveHidden(conversationId: string, idbHidden: boolean): boolean {
  const ov = hiddenOverride.get(conversationId);
  if (ov === undefined) return idbHidden;
  if (ov === idbHidden) hiddenOverride.delete(conversationId);
  return ov;
}

/** Hide or unhide a chat in Teams (syncs to all clients). Chats only. */
export async function setChatHidden(conversationId: string, hidden: boolean): Promise<WriteResult> {
  if (isChannelId(conversationId)) return { ok: false, reason: "channels cannot be hidden" };
  const r = await chat.setChatHidden(conversationId, hidden);
  if (!r.ok) return r;
  hiddenOverride.set(conversationId, hidden);
  return { ok: true, via: "cdl" };
}

// PUT one conversation property through chatsvc, same ic3 bearer as send.
async function putConversationProperty(conversationId: string, name: string, value: string): Promise<WriteResult> {
  return toWrite(await chatsvc.putConversationProperty(conversationId, name, value));
}

// Move a conversation's read pointer: PUT consumptionhorizon "<msgId>;<ms>;<msgId>"
// (message ids are arrival ms), plus consumptionHorizonBookmark "0;<ms>;0", the
// marker Teams' own mark-as-unread sets. Verified live: both return 200 and the
// IDB row updates within a second. chatsvc only moves consumptionhorizon forward
// (a backward PUT returns 200 but is ignored), so mark-unread lands only in the
// bookmark and Teams' own isRead stays true; the overlay keeps it via the override.
// Real server write that syncs to all the user's devices; nothing is sent/deleted.
async function writeHorizon(conversationId: string, v: number): Promise<WriteResult> {
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
  if (!token("ic3")) {
    pendingHorizon.set(conversationId, v);
    horizonOverride.set(conversationId, { ms: v });
    return { ok: true, via: "queued" };
  }
  pendingHorizon.delete(conversationId);
  const res = await writeHorizon(conversationId, v);
  if (res.ok) horizonOverride.set(conversationId, { ms: v });
  return res;
}

async function flushPendingHorizons(): Promise<void> {
  if (!pendingHorizon.size || !token("ic3")) return;
  for (const [id, v] of [...pendingHorizon]) {
    pendingHorizon.delete(id);
    const res = await writeHorizon(id, v);
    // Re-queue only transient failures (network, token gone, 5xx); a 4xx would
    // fail forever. Skip if a newer write for this chat was queued meanwhile.
    const transient = !res.ok && (res.reason === "fetch-failed" || res.reason === "no-token" || /^http-5/.test(res.reason));
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
    const r = isChannelId(conversationId) ? await chat.markChannelRead(conversationId, last) : await chat.markRead(conversationId, last);
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

// Mark unread: pull the pointer to just before the newest message so it counts
// as unread again. Needs the last message's time; falls back to now - 1s.
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

// Add or remove a reaction on a message. Captured from the native client:
//   add    PUT    .../messages/<id>/properties?name=emotions  {"emotions":{"key":<k>,"value":<ms>}}
//   remove DELETE .../messages/<id>/properties?name=emotions  {"emotions":{"key":<k>}}
// The ?name=emotions sub-resource is REQUIRED: a bare DELETE on .../messages/<id>
// is the message-DELETE route and removes the whole message. <k> is the reaction
// key ("like","heart","laugh",…), same ic3 bearer as send. Real server write that
// syncs to all devices.
export async function setReaction(
  conversationId: string,
  messageId: string,
  key: string,
  add: boolean
): Promise<WriteResult> {
  if (!isChannelId(conversationId)) {
    const c = await chat.setEmotion(conversationId, messageId, key, add);
    if (c.ok) {
      remoteCache.delete(conversationId);
      return { ok: true, via: "cdl" };
    }
  }
  const r = await chatsvc.putReaction(conversationId, messageId, key, add);
  if (!r.ok) return toWrite(r);
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Soft-delete a message. Captured from the native client:
//   DELETE .../messages/<id>?behavior=softDelete
// The ?behavior=softDelete query is REQUIRED: a bare DELETE hard-removes. Soft
// delete is reversible via undoDelete(). Real write, syncs to all devices.
export async function deleteMessage(conversationId: string, messageId: string): Promise<WriteResult> {
  const ref = msgRefs.get(String(messageId));
  if (!isChannelId(conversationId)) {
    const c = await chat.deleteMessage(conversationId, { id: String(messageId), clientMessageId: ref?.clientMessageId || "" });
    if (c.ok) {
      deletedHere.add(String(messageId));
      remoteCache.delete(conversationId);
      return { ok: true, via: "cdl" };
    }
  }
  const r = await chatsvc.softDeleteMessage(conversationId, messageId);
  if (!r.ok) return toWrite(r);
  deletedHere.add(String(messageId));
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Edit a message's text. chatsvc edit route:
//   PUT .../messages/<id>  {"content":"<html>","messagetype":"RichText/Html","contenttype":"Text"}
// content is wrapped in <p> like a fresh send. Real write, syncs to all devices.
// `quoteHtml`, when given, is a verbatim leading blockquote (from splitQuote)
// preserved across the edit; pass "" to drop a quote the user removed.
export async function editMessage(
  conversationId: string,
  messageId: string,
  text: string,
  quoteHtml = ""
): Promise<WriteResult> {
  const esc = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const content = (quoteHtml || "") + "<p>" + esc.replace(/\n/g, "<br>") + "</p>";
  const ref = msgRefs.get(String(messageId));
  if (ref && !isChannelId(conversationId)) {
    const c = await chat.sendMessage({
      convId: conversationId,
      content,
      clientMessageId: ref.clientMessageId || chat.newClientMessageId(),
      edit: { id: String(messageId), time: ref.time },
    });
    if (c.ok) {
      remoteCache.delete(conversationId);
      return { ok: true, via: "cdl" };
    }
    // An edit is idempotent, so retrying over REST is safe.
  }
  const r = await chatsvc.putMessage(conversationId, messageId, content);
  if (!r.ok) return toWrite(r);
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Undo a soft-delete by clearing the message's deletetime property. Captured:
//   DELETE .../messages/<id>/properties?name=deletetime   body {"deletetime":null}
export async function undoDelete(conversationId: string, messageId: string): Promise<WriteResult> {
  const r = await chatsvc.undoSoftDelete(conversationId, messageId);
  if (!r.ok) return toWrite(r);
  remoteCache.delete(conversationId);
  return { ok: true };
}
