import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  deleteMessage, editMessage, fetchOlderRemote, listMessages, primeRemote, removeFiles, resetPaging, setReaction, undoDelete,
} from "../../teamsData";
import { openNativeChat } from "../../send";
import { chat as chatSvc } from "../../services";
import { htmlToText } from "../lib/format";
import { formatMessage } from "../../markdown";
import { isIdle, onTeamsChange } from "../lib/live";
import { INITIAL_REMOTE, POLL_MS } from "../lib/constants";
import type { Flash } from "../lib/toast";
import type { Chat, Message as Msg } from "../../types";
import { t } from "../../i18n";

// Plain text without whitespace or "@", for matching a draft to its synced copy.
const bare = (s: string): string => s.replace(/[\s@]+/g, "");
const STALE_PENDING_MS = 15_000;
const CLOCK_SKEW_MS = 5_000;

// An optimistic message shown immediately after sending, before Teams syncs the
// real one back.
export interface Pending {
  key: number; chatId: string; text: string; time: number;
  /** Channel thread it replies in. */
  rootId?: string;
  /** Names of the files it carries. */
  files?: string[];
}
// Recent/older message buckets for the open chat (older is the paged-up history).
interface MsgBucket { id: string | null; list: Msg[]; loaded: boolean; failed?: boolean; }
interface OldBucket { id: string | null; list: Msg[]; }

// Cheap change signature so polling doesn't re-render (and jump) when idle.
const sig = (list: Msg[]): string =>
  list.map((m) => `${m.id}:${m.time}:${m.edited}:${m.deleted}:${m.reactions.map((r) => r.key + r.count + (r.mine ? "*" : "")).join()}`).join("|");

export interface Messages {
  /** Recent + paged-older messages of the open chat, merged and sorted. */
  shown: Msg[];
  /** My optimistic messages for the open chat. */
  myPending: Pending[];
  addPending: (p: Pending) => void;
  dropPending: (key: number) => void;
  /** First load of the open chat still running. */
  loading: boolean;
  /** The open chat's messages arrived (possibly empty). */
  ready: boolean;
  /** Backend never answered for the open chat. */
  failed: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  /** Wrapper around the rendered list; its size changes keep the view pinned. */
  content: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  stickyDay: string;
  atBottom: boolean;
  scrollToBottom: () => void;
  /** Pin the view to the bottom on the next render (after a send). */
  stickToBottom: () => void;
  loadOlder: () => Promise<void>;
  /** True once the server has no older page. */
  noMore: RefObject<boolean>;
  refetch: () => void;
  react: (cid: string, messageId: string, key: string, add: boolean) => Promise<void>;
  remove: (cid: string, messageId: string) => Promise<void>;
  removeFile: (cid: string, messageId: string, index: number) => Promise<void>;
  undo: (cid: string, messageId: string) => Promise<void>;
  edit: (cid: string, messageId: string, text: string, quoteHtml?: string) => Promise<void>;
}

// Messages of the selected chat: polled, plus live events for chats; backward
// paging, scroll pinning and optimistic writes.
export function useMessages(sel: string | null, selChat: Chat | undefined, flash: Flash): Messages {
  const selIsChannel = !!selChat?.isChannel;
  const [msgs, setMsgs] = useState<MsgBucket>({ id: null, list: [], loaded: false });
  const [older, setOlder] = useState<OldBucket>({ id: null, list: [] });
  // Ids currently rendered, so loadOlder can tell a page that adds nothing.
  const shownIds = useRef<Set<string>>(new Set());
  const oldestId = useRef("");
  const [pending, setPending] = useState<Pending[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Set by loadOlder before prepending a page: the scroll metrics to restore
  // against, applied in a layout effect so the shifted frame is never painted.
  const anchor = useRef<{ h: number; top: number } | null>(null);
  const stick = useRef(true);
  const paging = useRef(false);
  const noMore = useRef(false);
  const lastMsgSig = useRef("");
  const nullTicks = useRef(0); // consecutive unreachable ticks for the open chat
  const hydrated = useRef(false); // tried native-open to populate IDB for this chat

  // Messages for the selected chat: polled, plus live events for chats.
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    lastMsgSig.current = "";
    nullTicks.current = 0;
    hydrated.current = false;
    stick.current = true;
    paging.current = false;
    noMore.current = false;
    resetPaging(sel);
    setMsgs({ id: sel, list: [], loaded: false });
    setOlder({ id: sel, list: [] });
    // Capture a backward-paging cursor so scroll-up works even for chats whose
    // recent messages come from the local cache. Merge any remote-only messages.
    (async () => {
      const page = await primeRemote(sel, selIsChannel);
      if (!alive || !page || !page.length) return;
      setOlder((o) => {
        const base = o.id === sel ? o.list : [];
        const seen = new Set(base.map((m) => m.id));
        return { id: sel, list: [...page.filter((m) => !seen.has(m.id)), ...base] };
      });
    })();
    const tick = async (force?: boolean): Promise<void> => {
      if (!force && isIdle()) return;
      try {
        const list = await listMessages(sel, { channel: selIsChannel, remoteLimit: INITIAL_REMOTE });
        if (!alive) return;
        // null = backend unreachable this tick (no token yet / transient error).
        // Keep showing the loading state for a few retries, then surface a
        // "couldn't load" state (with a retry) instead of spinning forever when
        // the token never arrives or this chat's remote fetch always errors.
        if (list === null) {
          nullTicks.current += 1;
          // No local replychain and no token to fetch remotely: this chat was
          // never opened in native Teams, so nothing is cached. Drive native
          // Teams to open it once; its worker then fetches the thread and
          // persists the replychain to IndexedDB, which the next poll reads.
          if (!hydrated.current) {
            hydrated.current = true;
            void openNativeChat(sel, selChat?.title);
          }
          if (nullTicks.current >= 5) setMsgs({ id: sel, list: [], loaded: true, failed: true });
          return;
        }
        nullTicks.current = 0;
        const s = sig(list);
        if (s !== lastMsgSig.current || force) {
          lastMsgSig.current = s;
          setMsgs({ id: sel, list, loaded: true });
        }
      } catch {
        if (alive) setMsgs({ id: sel, list: [], loaded: true });
      }
    };
    tick(true);
    const t = setInterval(tick, POLL_MS);
    const offLive = onTeamsChange(() => tick());
    // Push: Teams' chat-pane event subscription. Re-read on each message event,
    // once now and once shortly after, since the worker may still be writing
    // the message to IndexedDB. Polling stays as the fallback.
    let late: ReturnType<typeof setTimeout> | undefined;
    const offEvents = selIsChannel
      ? () => {}
      : chatSvc.watchChatEvents(sel, (evs) => {
          if (!evs.some((e) => e.convId === sel && /Message/.test(e.type))) return;
          void tick();
          clearTimeout(late);
          late = setTimeout(() => void tick(), 600);
        });
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(late);
      offLive();
      offEvents();
    };
  }, [sel, selIsChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop optimistic messages once Teams has synced the real one. The draft is
  // markdown and the synced copy HTML, so both go through the same renderer
  // and compare as plain text without whitespace or "@"; a suffix match
  // allows for the quote Teams puts in front of a reply.
  // Layout effect: the synced copy and its pending bubble never paint together.
  useLayoutEffect(() => {
    if (!pending.length) return;
    const mine = msgs.list.filter((m) => m.mine);
    const texts = mine.map((m) => bare(htmlToText(m.content)));
    const now = Date.now();
    setPending((p) => p.filter((x) => {
      if (x.chatId !== msgs.id) return true;
      const s = bare(htmlToText(formatMessage(x.text).html));
      if (s && texts.some((t) => t.endsWith(s))) return false;
      // A file-only send has no text: match a newer message of mine with the same files.
      const names = x.files || [];
      if (!s && names.length && mine.some((m) => m.time >= x.time - CLOCK_SKEW_MS && names.every((n) => m.files.some((f) => f.name === n)))) return false;
      // Unmatched (rewritten by Teams?): give up once a newer message of mine has synced.
      return !(now - x.time > STALE_PENDING_MS && mine.some((m) => m.time >= x.time - CLOCK_SKEW_MS));
    }));
  }, [msgs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view pinned to the bottom only if the user was already there;
  // after a paged-in older page, keep the same message under the cursor.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const a = anchor.current;
    if (a) {
      anchor.current = null;
      el.scrollTop = a.top + (el.scrollHeight - a.h);
    } else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, older, pending]);
  // Content that grows after render (images, link previews, avatars, fonts)
  // would otherwise push the newest message out of view.
  useEffect(() => {
    const el = scroller.current;
    const box = content.current;
    if (!el || !box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(box);
    return () => ro.disconnect();
  }, [sel]);
  const loadOlder = useCallback(async (): Promise<void> => {
    if (paging.current || noMore.current) return;
    const el = scroller.current;
    const cid = sel;
    paging.current = true;
    try {
      // Older pages can overlap what the local cache already shows; keep
      // paging (bounded) until one brings something new, or the view stays
      // stuck at top. An empty page means "nothing yet": stop, retry on the
      // next scroll.
      let page: Msg[] | null;
      let hops = 0;
      do {
        page = await fetchOlderRemote(cid!, selIsChannel, oldestId.current || undefined);
        if (cid !== sel) return; // switched chat mid-fetch
        if (!page) { noMore.current = true; return; }
      } while (page.length && page.every((m) => shownIds.current.has(m.id)) && ++hops < 20);
      if (!page.length) return;
      if (el) anchor.current = { h: el.scrollHeight, top: el.scrollTop };
      setOlder((o) => {
        const base = o.id === cid ? o.list : [];
        const seen = new Set(base.map((m) => m.id));
        const add = page.filter((m) => !seen.has(m.id));
        return { id: cid, list: [...add, ...base] };
      });
    } finally {
      paging.current = false;
    }
  }, [sel, selIsChannel]);

  // True while the message list is scrolled near the bottom; drives the
  // scroll-to-newest button (stick is a ref, so we mirror it into state here).
  const [atBottom, setAtBottom] = useState(true);
  const scrollToBottom = (): void => {
    const el = scroller.current;
    stick.current = true;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  // Sticky day label: the date of the last `.tc-day` divider scrolled past the
  // top of the list, so the day stays pinned while reading within it. It steps
  // aside while the next divider is close below, so two dates never stack.
  const [stickyDay, setStickyDay] = useState("");
  const updateStickyDay = (el: HTMLDivElement): void => {
    const days = el.querySelectorAll<HTMLElement>(".tc-day");
    let label = "";
    const top = el.scrollTop;
    for (const d of days) {
      const y = d.offsetTop - el.offsetTop;
      if (y <= top + 4) label = d.textContent || "";
      else {
        if (y - top < 120) label = "";
        break;
      }
    }
    setStickyDay(label);
  };

  const onScroll = (): void => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAtBottom(near);
    updateStickyDay(el);
    if (el.scrollTop < 60) loadOlder();
  };

  // Recompute the sticky day label when the chat opens or the list length changes
  // (new messages, paged-in history), not just on scroll.
  useEffect(() => {
    const el = scroller.current;
    if (el) updateStickyDay(el);
  });

  // Add (add=true) or remove a reaction. Optimistically patch the message in
  // both the recent and the paged-older lists, then write to Teams; restore the
  // snapshot on failure. One reaction per user per message, so adding one clears
  // any other reaction of mine.
  async function react(cid: string, messageId: string, key: string, add: boolean): Promise<void> {
    const patch = (m: Msg): Msg => {
      if (m.id !== messageId) return m;
      const rs = m.reactions.map((r) => ({ ...r }));
      if (add) {
        for (const r of rs) if (r.mine && r.key !== key) { r.count = Math.max(0, r.count - 1); r.mine = false; }
        const hit = rs.find((r) => r.key === key);
        if (hit) { if (!hit.mine) { hit.count += 1; hit.mine = true; } }
        else rs.push({ key, glyph: key, count: 1, mine: true });
      } else {
        const hit = rs.find((r) => r.key === key);
        if (hit) { hit.count = Math.max(0, hit.count - 1); hit.mine = false; }
      }
      return { ...m, reactions: rs.filter((r) => r.count > 0) };
    };
    setMsgs((s) => ({ ...s, list: s.list.map(patch) }));
    setOlder((s) => ({ ...s, list: s.list.map(patch) }));
    const res = await setReaction(cid, messageId, key, add);
    if (!res.ok) {
      // Force a re-fetch so the view returns to the server's truth.
      setMsgs((s) => ({ ...s, loaded: false }));
      lastMsgSig.current = "";
      flash(t().app.reactionFailed(res.reason));
    }
  }

  // Patch one message in both the recent and paged-older lists.
  function patchMsg(messageId: string, fn: (m: Msg) => Msg): void {
    const apply = (m: Msg): Msg => (m.id === messageId ? fn(m) : m);
    setMsgs((s) => ({ ...s, list: s.list.map(apply) }));
    setOlder((s) => ({ ...s, list: s.list.map(apply) }));
  }
  const refetch = (): void => { setMsgs((s) => ({ ...s, loaded: false, failed: false })); lastMsgSig.current = ""; nullTicks.current = 0; hydrated.current = false; };

  // Soft-delete my message (reversible via Undo). Optimistic; refetch on failure.
  async function remove(cid: string, messageId: string): Promise<void> {
    patchMsg(messageId, (m) => ({ ...m, deleted: true }));
    const res = await deleteMessage(cid, messageId);
    if (!res.ok) { refetch(); flash(t().app.deleteFailed(res.reason)); }
  }

  // Undo a soft-delete: refetch to pull back the restored content.
  async function undo(cid: string, messageId: string): Promise<void> {
    const res = await undoDelete(cid, messageId);
    if (res.ok) refetch();
    else flash(t().app.undoFailed(res.reason));
  }

  // Take one file off a sent message. With no text and no files left, the
  // message would be empty, so it is deleted instead (undo stays available).
  async function removeFile(cid: string, messageId: string, index: number): Promise<void> {
    const m = msgs.list.find((x) => x.id === messageId) || older.list.find((x) => x.id === messageId);
    if (!m) return;
    const keep = m.files.filter((_, i) => i !== index);
    if (!keep.length && !htmlToText(m.content).trim()) return remove(cid, messageId);
    patchMsg(messageId, (x) => ({ ...x, files: keep }));
    const res = await removeFiles(cid, messageId, keep);
    if (!res.ok) { refetch(); flash(t().app.removeFileFailed(res.reason)); }
  }

  // Edit my message. `text` is the reply body; `quoteHtml` ("" if removed) is a
  // preserved leading blockquote. Optimistically rebuild the stored HTML so the
  // bubble updates at once; refetch on failure.
  async function edit(cid: string, messageId: string, text: string, quoteHtml = ""): Promise<void> {
    const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const content = (quoteHtml || "") + "<p>" + esc.replace(/\n/g, "<br>") + "</p>";
    patchMsg(messageId, (m) => ({ ...m, content, edited: true }));
    const res = await editMessage(cid, messageId, text, quoteHtml);
    if (!res.ok) { refetch(); flash(t().app.editFailed(res.reason)); }
  }

  const shown = useMemo(() => {
    const recent = msgs.id === sel ? msgs.list : [];
    const old = older.id === sel ? older.list : [];
    if (!old.length) return recent;
    const byId = new Map<string, Msg>();
    for (const m of old) byId.set(m.id, m);
    for (const m of recent) byId.set(m.id, m); // recent wins (fresher version)
    const all = [...byId.values()];
    all.sort(selIsChannel
      ? (a, b) => a.rootTime - b.rootTime || Number(a.isReply) - Number(b.isReply) || a.time - b.time
      : (a, b) => a.time - b.time);
    return all;
  }, [msgs, older, sel, selIsChannel]);
  shownIds.current = useMemo(() => new Set(shown.map((m) => m.id)), [shown]);
  // Oldest message on screen by time (channels sort by thread, not time):
  // where the next older page starts.
  oldestId.current = useMemo(() => {
    let o: Msg | undefined;
    for (const m of shown) if (!o || m.time < o.time) o = m;
    return o?.id || "";
  }, [shown]);

  // Stable identities for the per-message actions, so memoized messages skip
  // re-rendering on every poll and scroll state change.
  const acts = useRef({ react, remove, removeFile, undo, edit });
  acts.current = { react, remove, removeFile, undo, edit };
  const stable = useMemo(() => ({
    react: (...a: Parameters<typeof react>) => acts.current.react(...a),
    remove: (...a: Parameters<typeof remove>) => acts.current.remove(...a),
    removeFile: (...a: Parameters<typeof removeFile>) => acts.current.removeFile(...a),
    undo: (...a: Parameters<typeof undo>) => acts.current.undo(...a),
    edit: (...a: Parameters<typeof edit>) => acts.current.edit(...a),
  }), []);

  const ready = msgs.loaded && msgs.id === sel;
  return {
    shown,
    myPending: pending.filter((p) => p.chatId === sel),
    addPending: (p) => setPending((ps) => [...ps, p]),
    dropPending: (key) => setPending((ps) => ps.filter((x) => x.key !== key)),
    loading: msgs.id === sel && !msgs.loaded,
    ready,
    failed: ready && !!msgs.failed,
    scroller, content, onScroll, stickyDay, atBottom, scrollToBottom,
    stickToBottom: () => { stick.current = true; },
    loadOlder, noMore, refetch, ...stable,
  };
}
