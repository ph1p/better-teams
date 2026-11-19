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

import type { Chat, ChatKind, FileRef, Message, Profile, Quote, Reaction, Token, WriteResult } from "./types";

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
// mtRegion differs from the chatsvc region (e.g. emea vs de); tokenCapture
// records it as window.__tcMtRegion. Only org users (8:orgid:) have photos.
export function profilePhotoUrl(mri: string): string {
  if (!CURRENT_OID || !mri || mri.indexOf("8:orgid:") !== 0) return "";
  const reg = (typeof window !== "undefined" && window.__tcMtRegion) || "emea";
  return (
    `/api/mt/${reg}/beta/users/${CURRENT_OID}/profilepicturev2/` +
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

export async function listChats(): Promise<Chat[]> {
  const db = await open("conversation");
  const rows = (await getAll(db, "conversations", 10000)).map(obj);
  const favs = await favoriteIds();
  const spaces: Record<string, Dict> = {};
  for (const c of rows) if (c.type === "Space") spaces[str(c.id)] = c;
  const me = myMri();

  const chats: Chat[] = [];
  for (const c of rows) {
    const kind = KIND[str(c.type)];
    if (!kind || !c.id || !c.lastMessage) continue;
    const tp = obj(c.threadProperties);
    if (tp.isdeleted === "true" || tp.isdeleted === true) continue;
    const props = obj(c.properties);
    const lm = obj(c.lastMessage);
    const time = toMs(c.lastMessageTimeUtc) || toMs(lm.originalarrivaltime) || toMs(lm.composetime);
    if (!time) continue;

    const others = arr(c.members)
      .map((m) => str(get(m, "id")) || str(get(m, "mri")))
      .filter((id) => id && id !== me);
    const teamKey = str(c.teamId) || str(tp.spaceId);
    const team = kind === "channel" ? spaces[teamKey] : undefined;
    const teamTp = obj(team && team.threadProperties);
    const teamName = team ? str(teamTp.spaceThreadTopic) || str(teamTp.topic) : "";
    const lastFromMe = mriOf(lm.from) === me;
    const horizon = effectiveHorizon(str(c.id), toMs(String(props.consumptionhorizon ?? "").split(";")[0]));

    chats.push({
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
      time,
      unread: !lastFromMe && horizon > 0 && time > horizon,
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
      if (SKIP_TYPES.test(str(m.messageType))) continue;
      const n = normMessage(raw, rc);
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

// Live ic3 bearer captured in-page from Teams' own traffic (tokenCapture.ts
// wraps window.fetch) and parked on window.__tcTok = { ic3, region, at }.
function liveToken(): Token | null {
  const t = (typeof window !== "undefined" && window.__tcTok) || null;
  return t && t.ic3 ? t : null;
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
  const t = liveToken();
  if (!t) return null;
  const reg = t.region || "de";
  // chatsvc caps pageSize at 200 (HTTP 400 "PageSize ... should be <= 200").
  const pageSize = Math.min(limit, 200);
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}` +
    `/messages?view=msnp24Equivalent%7CsupportsMessageProperties&pageSize=${pageSize}&startTime=1`;
  let j: unknown;
  try {
    const r = await fetch(url, { headers: { authorization: "Bearer " + t.ic3 } });
    if (!r.ok) return null;
    j = await r.json();
  } catch {
    return null;
  }
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
    if (SKIP_TYPES.test(str(m.messagetype))) continue;
    // chatsvc carries rootMessageId per message, so channels can thread the same
    // way cached replychains do. Build a minimal rc from it; chats ignore it.
    const root = channel ? String(m.rootMessageId || m.id) : null;
    const rc: ChainCtx | null = root ? { replyChainId: root, originalArrivalTime: null } : null;
    const n = normMessage(raw, rc);
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

// conversationId -> chatsvc backwardLink URL for the next older page (or null at
// the start of history). Set by fetchRemoteMessages, advanced by fetchOlderRemote.
const backwardLinks = new Map<string, string | null>();

// Follow the stored backwardLink to load the next older page of a remote chat.
// Returns an array of older messages (may be empty at start of history), or null
// if there's no link yet or the request fails. Advances the link for the next call.
export async function fetchOlderRemote(conversationId: string, channel = false): Promise<Message[] | null> {
  const link = backwardLinks.get(conversationId);
  if (!link) return null;
  const t = liveToken();
  if (!t) return null;
  // backwardLink is an absolute teams.microsoft.com URL; use its path so the
  // same-origin fetch (and the page's auth plumbing) applies.
  let path: string;
  try { const u = new URL(link); path = u.pathname + u.search; } catch { path = link; }
  let j: unknown;
  try {
    const r = await fetch(path, { headers: { authorization: "Bearer " + t.ic3 } });
    if (!r.ok) return null;
    j = await r.json();
  } catch {
    return null;
  }
  // Advance (or clear) the link. A link that doesn't change, or no messages,
  // means we've reached the start of history.
  const next = str(get(get(j, "_metadata"), "backwardLink")) || null;
  backwardLinks.set(conversationId, next === link ? null : next);
  return parseRemotePage(j, channel);
}

// Fetch the first remote page purely to capture its backwardLink, so scroll-up
// pagination works even for chats whose recent messages came from the local
// IndexedDB cache (which carries no paging cursor). Returns the parsed page so
// the caller can merge any messages the cache was missing. Skips the work when
// a backward link is already known for this chat.
export async function primeRemote(conversationId: string, channel = false): Promise<Message[] | null> {
  if (backwardLinks.has(conversationId)) return null;
  const t = liveToken();
  if (!t) return null;
  const reg = t.region || "de";
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}` +
    `/messages?view=msnp24Equivalent%7CsupportsMessageProperties&pageSize=30&startTime=1`;
  let j: unknown;
  try {
    const r = await fetch(url, { headers: { authorization: "Bearer " + t.ic3 } });
    if (!r.ok) return null;
    j = await r.json();
  } catch {
    return null;
  }
  backwardLinks.set(conversationId, str(get(get(j, "_metadata"), "backwardLink")) || null);
  return parseRemotePage(j, channel);
}

// HTML-escape text for element content (used in quote preview/sender name).
const esc2 = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Build the native Skype Reply blockquote for a quote-reply. `quote` is
// { id, from, text, fromMri }; returns "" when there is nothing to quote.
export function buildQuoteHtml(quote: Quote | null): string {
  if (!quote || !quote.id) return "";
  const qid = String(quote.id).replace(/"/g, "&quot;");
  const qmri = String(quote.fromMri || "").replace(/"/g, "&quot;");
  const qfrom = esc2(quote.from || "");
  const qprev = esc2(String(quote.text || "").slice(0, 1000));
  return (
    `<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="${qid}">\r\n` +
    `<strong itemprop="mri" itemid="${qmri}">${qfrom}</strong>` +
    `<span itemprop="time" itemid="${qid}"></span>\r\n` +
    `<p itemprop="preview">${qprev}</p>\r\n` +
    `</blockquote>\r\n`
  );
}

// Split a message's stored HTML into { quoteHtml, body }: the leading Skype
// Reply blockquote (kept verbatim so an edit can preserve it) and the rest.
// No quote → { quoteHtml: "", body: content }.
export function splitQuote(content: string): { quoteHtml: string; body: string } {
  const m = /^\s*(<blockquote[^>]*itemtype="http:\/\/schema\.skype\.com\/Reply"[\s\S]*?<\/blockquote>)\s*/i.exec(content || "");
  if (!m) return { quoteHtml: "", body: content || "" };
  return { quoteHtml: m[1], body: (content || "").slice(m[0].length) };
}

// Random 18-digit client message id, matching Teams' own clientmessageid shape.
function newClientMessageId(): string {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < 18) s += Math.floor(Math.random() * 10);
  return s;
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
  quote: Quote | null
): Promise<WriteResult> {
  const body = (text || "").trim();
  if (!body) return { ok: false, reason: "empty" };
  const t = liveToken();
  if (!t) return { ok: false, reason: "no-token" };
  const reg = t.region || "de";
  const mri = myMri();
  const now = new Date().toISOString();
  // HTML-escape, then wrap in <p> exactly as Teams' composer does.
  const esc = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Native quote-reply: prepend the Skype Reply blockquote (captured format).
  const content = buildQuoteHtml(quote) + "<p>" + esc + "</p>";
  const payload = {
    id: "-1",
    type: "Message",
    conversationid: conversationId,
    conversationLink: "blah/" + conversationId,
    from: mri,
    fromUserId: mri,
    composetime: now,
    originalarrivaltime: now,
    content,
    messagetype: "RichText/Html",
    contenttype: "Text",
    imdisplayname: profile(mri).displayName || "",
    clientmessageid: newClientMessageId(),
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
      mentions: "[]",
      onbehalfof: null,
      files: "[]",
      policyViolation: null,
      formatVariant: "TEAMS",
    },
    crossPostChannels: [] as string[],
  };
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}/messages`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer " + t.ic3,
        "content-type": "application/json",
        behavioroverride: "redirectAs404",
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
  // Our cached view is now stale; drop it so the next poll re-fetches.
  remoteCache.delete(conversationId);
  return { ok: true, via: "endpoint" };
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

// PUT one conversation property through chatsvc, same ic3 bearer as send.
async function putConversationProperty(conversationId: string, name: string, value: string): Promise<WriteResult> {
  const t = liveToken();
  if (!t) return { ok: false, reason: "no-token" };
  const reg = t.region || "de";
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}` +
    `/properties?name=${encodeURIComponent(name)}`;
  try {
    const r = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: "Bearer " + t.ic3,
        "content-type": "application/json",
        behavioroverride: "redirectAs404",
      },
      body: JSON.stringify({ [name]: value }),
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
  return { ok: true };
}

// Move a conversation's read pointer. The read state lives in the
// "consumptionhorizon" property ("<msgId>;<ms>;<msgId>"; message ids are arrival
// ms) - that is what listChats reads back. "consumptionHorizonBookmark" is only
// the native "mark as unread" marker; writing it alone never marks anything read.
// Real server write that syncs to all the user's devices; nothing is sent/deleted.
async function setConsumptionHorizon(conversationId: string, ms: number): Promise<WriteResult> {
  const v = Math.round(ms);
  const res = await putConversationProperty(conversationId, "consumptionhorizon", `${v};${v};${v}`);
  if (res.ok) horizonOverride.set(conversationId, { ms: v });
  return res;
}

// Mark read: push the pointer just past the newest message (default: now).
export function markRead(conversationId: string, lastMessageMs?: number): Promise<WriteResult> {
  const ms = lastMessageMs ? lastMessageMs + 1 : Date.now();
  return setConsumptionHorizon(conversationId, ms);
}

// Mark unread: pull the pointer to just before the newest message so it counts
// as unread again, and set the bookmark the native client uses for the same
// action. Needs the last message's time; falls back to now - 1s.
export async function markUnread(conversationId: string, lastMessageMs?: number): Promise<WriteResult> {
  const ms = Math.round((lastMessageMs || Date.now()) - 1000);
  const res = await setConsumptionHorizon(conversationId, ms);
  if (res.ok) await putConversationProperty(conversationId, "consumptionHorizonBookmark", `0;${ms};0`);
  return res;
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
  const t = liveToken();
  if (!t) return { ok: false, reason: "no-token" };
  const reg = t.region || "de";
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}` +
    `/messages/${encodeURIComponent(messageId)}/properties?name=emotions`;
  const body = add
    ? { emotions: { key, value: Date.now() } }
    : { emotions: { key } };
  try {
    const r = await fetch(url, {
      method: add ? "PUT" : "DELETE",
      headers: {
        authorization: "Bearer " + t.ic3,
        "content-type": "application/json",
        behavioroverride: "redirectAs404",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Soft-delete a message. Captured from the native client:
//   DELETE .../messages/<id>?behavior=softDelete
// The ?behavior=softDelete query is REQUIRED: a bare DELETE hard-removes. Soft
// delete is reversible via undoDelete(). Real write, syncs to all devices.
export async function deleteMessage(conversationId: string, messageId: string): Promise<WriteResult> {
  const t = liveToken();
  if (!t) return { ok: false, reason: "no-token" };
  const reg = t.region || "de";
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}` +
    `/messages/${encodeURIComponent(messageId)}?behavior=softDelete`;
  try {
    const r = await fetch(url, {
      method: "DELETE",
      headers: {
        authorization: "Bearer " + t.ic3,
        "content-type": "application/json",
        behavioroverride: "redirectAs404",
      },
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
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
  const t = liveToken();
  if (!t) return { ok: false, reason: "no-token" };
  const reg = t.region || "de";
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}` +
    `/messages/${encodeURIComponent(messageId)}`;
  const esc = String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const content = (quoteHtml || "") + "<p>" + esc.replace(/\n/g, "<br>") + "</p>";
  try {
    const r = await fetch(url, {
      method: "PUT",
      headers: {
        authorization: "Bearer " + t.ic3,
        "content-type": "application/json",
        behavioroverride: "redirectAs404",
      },
      body: JSON.stringify({ content, messagetype: "RichText/Html", contenttype: "Text" }),
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Undo a soft-delete by clearing the message's deletetime property. Captured:
//   DELETE .../messages/<id>/properties?name=deletetime   body {"deletetime":null}
export async function undoDelete(conversationId: string, messageId: string): Promise<WriteResult> {
  const t = liveToken();
  if (!t) return { ok: false, reason: "no-token" };
  const reg = t.region || "de";
  const url =
    `/api/chatsvc/${reg}/v1/users/ME/conversations/${encodeURIComponent(conversationId)}` +
    `/messages/${encodeURIComponent(messageId)}/properties?name=deletetime`;
  try {
    const r = await fetch(url, {
      method: "DELETE",
      headers: {
        authorization: "Bearer " + t.ic3,
        "content-type": "application/json",
        behavioroverride: "redirectAs404",
      },
      body: JSON.stringify({ deletetime: null }),
    });
    if (!r.ok) return { ok: false, reason: "http-" + r.status };
  } catch {
    return { ok: false, reason: "fetch-failed" };
  }
  remoteCache.delete(conversationId);
  return { ok: true };
}
