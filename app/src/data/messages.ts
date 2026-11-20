// Message reads: local IndexedDB first, then Teams' worker (CDL), then chatsvc
// REST; plus scroll-up paging cursors for both remote paths.
import type { Message } from "../types";
import { chat, chatsvc } from "../services";
import { getByPrefix, open } from "./idb";
import { asCallRoot, hiddenDeleted, normCdlMessage, normMessage, parseRemotePage, skipType, sortMessages, type ChainCtx } from "./normalize";
import { get, obj, str } from "./raw";
import { REMOTE_TTL, remoteCache } from "./state";

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
