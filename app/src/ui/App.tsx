import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from "react";
import {
  deleteMessage, editMessage, fetchOlderRemote, listChats, listMessages, loadProfiles,
  markRead, markUnread, myMri, setChatHidden, primeRemote, profile, searchPeople, sendRemote, setReaction, splitQuote, undoDelete,
  type PeopleHit,
} from "../teamsData";
import { openNativeChat, openNativeNewChat, sendMessage, sendNativeDraft, startNativeCall, type PickPerson } from "../send";
import { chat as chatSvc, typing } from "../services";
import {
  Send, Search, Hash, MailOpen, Mail, ExternalLink, X, Reply, Phone, Video, RotateCw,
  ArrowDown, Smile, Eye, EyeOff, CheckCheck, SquarePen, Rows2, Rows3,
} from "lucide-react";
import { EmojiPicker } from "./shared/EmojiPicker";
import { Avatar } from "./shared/Avatar";
import { Section } from "./sidebar/Section";
import { MeBar } from "./sidebar/MeBar";
import { NewChat, type NewChatOutcome } from "./sidebar/NewChat";
import { Message } from "./chat/Message";
import { ProfilePanel } from "./profile/ProfilePanel";
import { avatarUri, fmtDay, htmlToText, messageText, oneLine } from "./lib/format";
import { isIdle, onTeamsChange } from "./lib/live";
import { STATUS_LABEL, usePresence } from "./lib/presence";
import { usePref } from "./lib/prefs";
import { GROUP_GAP_MS, INITIAL_REMOTE, MAX_CALL, POLL_MS } from "./lib/constants";
import type { Chat, Message as Msg, Quote } from "../types";
import type { MentionPick } from "../mentions";

// One sidebar group as built by App; rendered by <Section>.
interface SideSection {
  id: string;
  title: string;
  rows: Chat[];
  capped?: boolean;
  groupByTeam?: boolean;
  defaultCollapsed?: boolean;
}

// An optimistic message shown immediately after sending, before Teams syncs the
// real one back.
interface Pending { key: number; chatId: string; text: string; time: number; }
// Right-click chat menu position + target.
interface Menu { x: number; y: number; chat: Chat; }
// Recent/older message buckets for the open chat (older is the paged-up history).
interface MsgBucket { id: string | null; list: Msg[]; loaded: boolean; failed?: boolean; }
interface OldBucket { id: string | null; list: Msg[]; }

// Cheap change signature so polling doesn't re-render (and jump) when idle.
const sig = (list: Msg[]): string =>
  list.map((m) => `${m.id}:${m.time}:${m.edited}:${m.deleted}:${m.reactions.map((r) => r.key + r.count + (r.mine ? "*" : "")).join()}`).join("|");
const chatSig = (list: Chat[]): string => list.map((c) => `${c.id}:${c.time}:${c.unread}:${c.hidden}:${c.title}`).join("|");

export default function App({ onHide }: { onHide?: () => void }): JSX.Element {
  const { statusOf } = usePresence();
  const [chats, setChats] = useState<Chat[]>([]);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<MsgBucket>({ id: null, list: [], loaded: false });
  const [older, setOlder] = useState<OldBucket>({ id: null, list: [] });
  // Ids currently rendered, so loadOlder can tell a page that adds nothing.
  const shownIds = useRef<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [query, setQuery] = useState("");
  // Sidebar "Unread" filter. Chats opened while it is on stay listed (keep) so
  // they don't vanish the moment they are read; leaving the filter drops them.
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Sidebar density: compact one-line rows (default) or name + preview.
  const [compact, setCompact] = usePref<boolean>("compact", true);
  const [keep, setKeep] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState("");
  const [profileMri, setProfileMri] = useState<string | null>(null);
  // Right-click chat menu: {x, y, chat} or null.
  const [menu, setMenu] = useState<Menu | null>(null);
  // In-conversation message search: open flag + query string.
  const [msgSearch, setMsgSearch] = useState("");
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  // A message being quote-replied to, shown as a chip above the composer: null
  // or { id, from, text }. Cleared on send or chat switch.
  const [quote, setQuote] = useState<Quote | null>(null);
  // @mention picks for the open chat's draft: the members the user has inserted.
  // Keyed per chat, like drafts. Entries whose `@Name` text is gone are dropped
  // at send time (buildMentionContent only emits still-present names).
  const [mentionPicks, setMentionPicks] = useState<Record<string, MentionPick[]>>({});
  // @-autocomplete popup: open flag + current filter query (text after the @).
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  // Org-directory @mention hits (debounced searchPeople), merged after local members.
  const [atOrg, setAtOrg] = useState<MentionPick[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const paging = useRef(false);
  const noMore = useRef(false);
  const search = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const lastChatSig = useRef("");
  const lastMsgSig = useRef("");
  const nullTicks = useRef(0); // consecutive unreachable ticks for the open chat
  const hydrated = useRef(false); // tried native-open to populate IDB for this chat

  const flashTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);
  const flash = useCallback((t: string, ms = 2500): void => {
    setToast(t);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setToast(""), ms);
  }, []);

  // Chat list, polled.
  useEffect(() => {
    let alive = true;
    const tick = async (force?: boolean): Promise<void> => {
      if (!force && isIdle()) return;
      try {
        await loadProfiles();
        const c = await listChats();
        if (!alive) return;
        setError("");
        const s = chatSig(c);
        if (s !== lastChatSig.current) {
          lastChatSig.current = s;
          setChats(c);
        }
        setSel((cur) => cur || (c[0] && c[0].id) || null);
      } catch (e) {
        if (alive) setError(String((e as Error).message || e));
      }
    };
    tick(true);
    const t = setInterval(tick, POLL_MS);
    const offLive = onTeamsChange(() => tick());
    const onVis = (): void => { tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      offLive();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const selChat = chats.find((c) => c.id === sel);
  // Calls: 1:1 and group chats ring their members (Teams rings at most 20 in a
  // group call). Channels, meetings and Notes have no callee list here.
  const callable = !!selChat && selChat.kind === "chat" && selChat.members.length > 0 && selChat.members.length <= MAX_CALL;
  const callLabel = (what: string): string =>
    !selChat || selChat.members.length <= 1 ? what : `Group ${what.toLowerCase()} (${selChat.members.length} people)`;
  const selIsChannel = !!selChat?.isChannel;
  // Header subtitle: what is useful to know about the other side right now.
  const headSub = !selChat ? "" :
    selChat.isChannel ? selChat.team :
    selChat.kind === "meeting" ? "Meeting chat" :
    selChat.kind === "notes" ? "Only you" :
    selChat.members.length > 1 ? `${selChat.members.length + 1} people` :
    selChat.avatarMri ? [statusOf(selChat.avatarMri) === "Unknown" ? "" : STATUS_LABEL[statusOf(selChat.avatarMri)], profile(selChat.avatarMri).jobTitle].filter(Boolean).join(" · ") :
    selChat.team;

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
    setMsgs({ id: sel, list: [], loaded: false });
    setOlder({ id: sel, list: [] });
    setMsgSearch("");
    setMsgSearchOpen(false);
    setQuote(null);
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
  }, [sel, selIsChannel]);

  // Drop optimistic messages once Teams has synced the real one.
  useEffect(() => {
    if (!pending.length) return;
    const texts = new Set(msgs.list.filter((m) => m.mine).map((m) => htmlToText(m.content).trim()));
    setPending((p) => p.filter((x) => !(x.chatId === msgs.id && texts.has(x.text.trim()))));
  }, [msgs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view pinned to the bottom only if the user was already there.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs, pending]);
  const loadOlder = useCallback(async (): Promise<void> => {
    if (paging.current || noMore.current) return;
    const el = scroller.current;
    const cid = sel;
    paging.current = true;
    const prevH = el ? el.scrollHeight : 0;
    const prevTop = el ? el.scrollTop : 0;
    try {
      // Older pages can overlap what the local cache already shows; keep paging
      // (bounded) until one brings something new, or the view stays stuck at top.
      let page: Msg[] | null;
      let hops = 0;
      do {
        page = await fetchOlderRemote(cid!, selIsChannel);
        if (cid !== sel) return; // switched chat mid-fetch
        if (!page) { noMore.current = true; return; }
      } while (page.length && page.every((m) => shownIds.current.has(m.id)) && ++hops < 10);
      if (!page.length) return;
      setOlder((o) => {
        const base = o.id === cid ? o.list : [];
        const seen = new Set(base.map((m) => m.id));
        const add = page.filter((m) => !seen.has(m.id));
        return { id: cid, list: [...add, ...base] };
      });
      // Preserve scroll position: keep the same message under the cursor.
      requestAnimationFrame(() => {
        const e2 = scroller.current;
        if (e2) e2.scrollTop = prevTop + (e2.scrollHeight - prevH);
      });
    } finally {
      paging.current = false;
    }
  }, [sel, selIsChannel]);

  const onScroll = (): void => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setAtBottom(near);
    updateStickyDay(el);
    if (el.scrollTop < 60) loadOlder();
  };

  // Sticky day label: the date of the last `.tc-day` divider scrolled past the
  // top of the list, so the day stays pinned while reading within it.
  const [stickyDay, setStickyDay] = useState("");
  const updateStickyDay = (el: HTMLDivElement): void => {
    const days = el.querySelectorAll<HTMLElement>(".tc-day");
    let label = "";
    const top = el.scrollTop;
    for (const d of days) {
      if (d.offsetTop - el.offsetTop <= top + 4) label = d.textContent || "";
      else break;
    }
    setStickyDay(label);
  };

  // Unread filter: chats opened during this filter session stay listed (keep)
  // even once read, so the open chat never vanishes; leaving the filter drops them.
  const sections = useMemo<SideSection[]>(() => {
    const q = query.toLowerCase().trim();
    if (q) {
      // Search: one flat result list, best matches first (title before team /
      // member names). Hidden chats are found too.
      const hay = (c: Chat): string =>
        (c.team + " " + c.members.map((m) => profile(m).displayName).join(" ")).toLowerCase();
      const byTitle = chats.filter((c) => c.title.toLowerCase().includes(q));
      const byOther = chats.filter((c) => !c.title.toLowerCase().includes(q) && hay(c).includes(q));
      const list = [...byTitle, ...byOther];
      return list.length ? [{ id: "search", title: "", rows: list, capped: false }] : [];
    }
    // Hidden chats leave the list, as in Teams; search still finds them.
    const list = chats.filter((c) => !c.hidden && (!unreadOnly || c.unread || keep.has(c.id)));
    if (unreadOnly) {
      // Unread filter: one flat inbox, newest first; headers would only repeat
      // the filter's own count.
      return list.length ? [{ id: "unread", title: "", rows: list, capped: false }] : [];
    }
    const pinned = (c: Chat): boolean => c.favorite || c.pinned;
    const rest = list.filter((c) => !pinned(c));
    // Channels grouped by team; teams ordered by their latest activity, so the
    // busy team sits on top. Within a team, newest first (list order).
    const channels = rest.filter((c) => c.kind === "channel");
    const teamRank = new Map<string, number>();
    channels.forEach((c, i) => { if (!teamRank.has(c.team)) teamRank.set(c.team, i); });
    channels.sort((a, b) => teamRank.get(a.team)! - teamRank.get(b.team)!);
    return ([
      { id: "fav", title: "Favorites", rows: list.filter(pinned) },
      { id: "dms", title: "Direct messages", rows: rest.filter((c) => c.kind === "notes" || (c.kind === "chat" && c.members.length <= 1)) },
      { id: "groups", title: "Groups", rows: rest.filter((c) => c.kind === "chat" && c.members.length > 1) },
      { id: "channels", title: "Channels", rows: channels, groupByTeam: true },
      { id: "meetings", title: "Meetings", rows: rest.filter((c) => c.kind === "meeting"), defaultCollapsed: true },
    ] as SideSection[]).filter((s) => s.rows.length);
  }, [chats, query, unreadOnly, keep]);
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const unreadCount = useMemo(() => chats.filter((c) => c.unread && !c.hidden).length, [chats]);

  const chatsRef = useRef<Chat[]>([]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  const pick = useCallback((id: string): void => {
    setSel(id);
    if (unreadOnly) setKeep((k) => (k.has(id) ? k : new Set(k).add(id)));
    // Opening a chat marks it read in Teams, same as the native client. Fire the
    // write and flip our flag only when the chat was actually unread; put the
    // flag back when the write fails, so the list doesn't lie until next poll.
    const hit = chatsRef.current.find((c) => c.id === id);
    if (hit && hit.unread) {
      setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: false } : c)));
      markRead(id, hit.time).then((res) => {
        if (res.ok) return;
        setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: true } : c)));
        flash("Couldn't mark as read (" + res.reason + ")");
      });
    }
    requestAnimationFrame(() => {
      document.querySelector(`#tc-root .tc-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, [flash, unreadOnly]);

  // Turn the Unread filter on/off. Turning it on opens the newest unread chat
  // unless the open one is unread itself; an already-read open chat is not
  // carried into the filter.
  const setUnreadFilter = useCallback((on: boolean): void => {
    setUnreadOnly(on);
    const cur = chatsRef.current.find((c) => c.id === sel);
    setKeep(new Set(on && cur && cur.unread ? [cur.id] : []));
    if (!on || (cur && cur.unread)) return;
    const u = chatsRef.current.find((c) => c.unread && !c.hidden);
    if (u) {
      setKeep(new Set([u.id]));
      pick(u.id);
    }
  }, [sel, pick]);

  // Keyboard: ⌘K search, ⌥↑/⌥↓ previous/next chat, ⌥⇧↑/⌥⇧↓ previous/next
  // unread chat, ⌥U Unread filter, Esc leaves search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isIdle()) return;
      if (e.metaKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        search.current?.focus();
        search.current?.select();
      } else if (e.metaKey && !e.altKey && e.key.toLowerCase() === "f") {
        // ⌘F searches within the open conversation (not the browser's find bar).
        e.preventDefault();
        e.stopPropagation();
        if (sel) setMsgSearchOpen(true);
      } else if (e.key === "Escape" && msgSearchOpen) {
        setMsgSearch("");
        setMsgSearchOpen(false);
      } else if (e.altKey && !e.metaKey && e.code === "KeyU") {
        e.preventDefault();
        e.stopPropagation();
        setUnreadFilter(!unreadOnly);
      } else if (e.altKey && !e.metaKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        // Next unread below (or above) the open chat, wrapping around.
        const up = e.key === "ArrowUp";
        const i = flat.findIndex((c) => c.id === sel);
        const n = flat.length;
        for (let k = 1; k <= n; k++) {
          const c = flat[(((i < 0 ? (up ? 0 : -1) : i) + (up ? -k : k)) % n + n) % n];
          if (c && c.unread && c.id !== sel) { pick(c.id); break; }
        }
      } else if (e.altKey && !e.metaKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        e.stopPropagation();
        const i = flat.findIndex((c) => c.id === sel);
        const next = flat[Math.max(0, Math.min(flat.length - 1, i + (e.key === "ArrowUp" ? -1 : 1)))];
        if (next) pick(next.id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [flat, sel, pick, msgSearchOpen, unreadOnly, setUnreadFilter]);

  const draft = (sel && drafts[sel]) || "";
  const setDraft = (v: string): void => setDrafts((d) => ({ ...d, [sel!]: v }));

  // Insert text at the composer's caret (or append), keeping focus and caret.
  const insertAtCaret = (ins: string): void => {
    const el = composer.current;
    if (!el) { setDraft(draft + ins); return; }
    const s = el.selectionStart ?? draft.length;
    const e = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, s) + ins + draft.slice(e);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + ins.length;
      try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  };

  // Resolved, filtered @mention candidates for the open chat: its members (minus
  // me) whose display name matches the text typed after the "@".
  const myself = myMri();
  const atCandidates = useMemo<MentionPick[]>(() => {
    const chat = chats.find((c) => c.id === sel);
    if (!chat) return [];
    const q = atQuery.trim().toLowerCase();
    const seen = new Set<string>();
    const out: MentionPick[] = [];
    for (const mri of chat.members) {
      if (!mri || mri === myself || seen.has(mri)) continue;
      seen.add(mri);
      const name = profile(mri).displayName || "";
      if (!name) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      out.push({ mri, name, mentionType: "person" });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    // Append org-directory hits (anyone, not just chat members), deduped by mri.
    for (const p of atOrg) {
      if (!p.mri || p.mri === myself || seen.has(p.mri)) continue;
      seen.add(p.mri);
      out.push(p);
    }
    return out.slice(0, 8);
  }, [chats, sel, atQuery, myself, atOrg]);

  // Watch the draft for an "@word" the caret sits at the end of; open the picker
  // and track the query. Any other edit closes it.
  const onDraftChange = (v: string): void => {
    setDraft(v);
    // Teams signals typing on every non-empty editor change (throttled per chat).
    if (v.trim() && selChat) typing.notifyTyping({ convId: selChat.id, isChannel: selChat.isChannel, members: selChat.members });
    const el = composer.current;
    const caret = el?.selectionStart ?? v.length;
    // Match "@" preceded by start/space, up to the caret, name chars only.
    const upto = v.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(upto);
    if (m) { setAtQuery(m[1]); setAtOpen(true); }
    else { setAtOpen(false); setAtQuery(""); }
  };

  // Replace the half-typed "@query" at the caret with "@Display Name " and record
  // the pick so the send path can emit a real mention span.
  const pickMention = (pick: MentionPick): void => {
    const el = composer.current;
    const caret = el?.selectionStart ?? draft.length;
    const upto = draft.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(upto);
    const start = m ? caret - m[1].length - 1 : caret; // back over "@query"
    const insert = "@" + pick.name + " ";
    const next = draft.slice(0, start) + insert + draft.slice(caret);
    setDraft(next);
    setMentionPicks((mp) => {
      const cur = sel ? mp[sel] || [] : [];
      if (cur.some((p) => p.mri === pick.mri)) return mp;
      return sel ? { ...mp, [sel]: [...cur, pick] } : mp;
    });
    setAtOpen(false);
    setAtQuery("");
    setAtOrg([]);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + insert.length;
      try { el?.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  };

  // Close the @-picker when the open chat changes.
  useEffect(() => { setAtOpen(false); setAtQuery(""); setAtOrg([]); }, [sel]);

  // Debounced org-directory search while the @-picker is open. Local chat members
  // show instantly; org hits stream in ~250ms after typing stops. Stale responses
  // are dropped via the `live` guard so an older query can't overwrite a newer one.
  useEffect(() => {
    if (!atOpen) { setAtOrg([]); return; }
    const q = atQuery.trim();
    if (q.length < 2) { setAtOrg([]); return; }
    let live = true;
    const h = setTimeout(() => {
      searchPeople(q, 8)
        .then((hits) => {
          if (!live) return;
          setAtOrg(hits.map((p) => ({ mri: p.mri, name: p.displayName, mentionType: "person" })));
        })
        .catch(() => { /* keep local-only candidates */ });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [atOpen, atQuery]);

  // Recompute the sticky day label when the chat opens or the list length changes
  // (new messages, paged-in history), not just on scroll.
  useEffect(() => {
    const el = scroller.current;
    if (el) updateStickyDay(el);
  });

  const [emojiOpen, setEmojiOpen] = useState(false);
  // True while the message list is scrolled near the bottom; drives the
  // scroll-to-newest button (stick is a ref, so we mirror it into state here).
  const [atBottom, setAtBottom] = useState(true);
  const scrollToBottom = (): void => {
    const el = scroller.current;
    stick.current = true;
    if (el) el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  // Who is typing in the open chat (worker subscription; chats only, like send).
  const [typingLabel, setTypingLabel] = useState("");
  useEffect(() => {
    setTypingLabel("");
    if (!sel || selIsChannel) return;
    return typing.watchTyping(sel, (users) => {
      setTypingLabel(users.length ? users[0].typingUsersLabel || "Someone is typing" : "");
    });
  }, [sel, selIsChannel]);

  // Close the emoji picker when the open chat changes.
  useEffect(() => { setEmojiOpen(false); }, [sel]);

  // Auto-grow the composer.
  useLayoutEffect(() => {
    const el = composer.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [draft, sel]);

  async function doSend(): Promise<void> {
    const text = draft.trim();
    if (!text || !selChat) return;
    const chat = selChat;
    const q = quote;
    const picks = mentionPicks[chat.id] || [];
    const key = Date.now() + Math.random();
    setDrafts((d) => ({ ...d, [chat.id]: "" }));
    typing.resetTyping(chat.id);
    setQuote(null);
    setMentionPicks((mp) => ({ ...mp, [chat.id]: [] }));
    setAtOpen(false);
    setPending((p) => [...p, { key, chatId: chat.id, text, time: Date.now() }]);
    stick.current = true;
    // Prefer the direct chatsvc endpoint (works for any chat, cached or not).
    // Fall back to driving Teams' native composer only when no token is captured.
    let r = await sendRemote(chat.id, text, q, picks);
    if (!r.ok && r.reason === "no-token") r = await sendMessage(chat.id, chat.title, text);
    if (!r.ok) {
      setPending((p) => p.filter((x) => x.key !== key));
      setDrafts((d) => ({ ...d, [chat.id]: d[chat.id] || text }));
      setMentionPicks((mp) => ({ ...mp, [chat.id]: picks }));
      const why = ({
        "chat-not-open": "Teams has no visible row for this chat. Open it once in Teams (⌥⌘T), then retry.",
        "wrong-chat": "Teams switched to another chat. Not sent.",
        "no-composer": "Teams' message box wasn't found. Not sent.",
        "fetch-failed": "Couldn't reach Teams' backend. Not sent.",
        "http-401": "Teams' token expired. Open any chat in Teams to refresh, then retry.",
        "http-403": "Teams' backend refused the send (403). Not sent.",
      } as Record<string, string>)[r.reason] || "Send failed: " + r.reason;
      flash(why, 5000);
    }
  }

  // Add (add=true) or remove a reaction. Optimistically patch the message in
  // both the recent and the paged-older lists, then write to Teams; restore the
  // snapshot on failure. One reaction per user per message, so adding one clears
  // any other reaction of mine.
  async function reactToMsg(cid: string, messageId: string, key: string, add: boolean): Promise<void> {
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
      flash("Reaction failed (" + res.reason + ")");
    }
  }

  // Patch one message in both the recent and paged-older lists.
  function patchMsg(messageId: string, fn: (m: Msg) => Msg): void {
    const apply = (m: Msg): Msg => (m.id === messageId ? fn(m) : m);
    setMsgs((s) => ({ ...s, list: s.list.map(apply) }));
    setOlder((s) => ({ ...s, list: s.list.map(apply) }));
  }
  const refetchMsgs = (): void => { setMsgs((s) => ({ ...s, loaded: false, failed: false })); lastMsgSig.current = ""; nullTicks.current = 0; hydrated.current = false; };

  // Soft-delete my message (reversible via Undo). Optimistic; refetch on failure.
  async function deleteMsg(cid: string, messageId: string): Promise<void> {
    patchMsg(messageId, (m) => ({ ...m, deleted: true }));
    const res = await deleteMessage(cid, messageId);
    if (!res.ok) { refetchMsgs(); flash("Delete failed (" + res.reason + ")"); }
  }

  // Undo a soft-delete: refetch to pull back the restored content.
  async function undoDeleteMsg(cid: string, messageId: string): Promise<void> {
    const res = await undoDelete(cid, messageId);
    if (res.ok) refetchMsgs();
    else flash("Undo failed (" + res.reason + ")");
  }

  // Edit my message. `text` is the reply body; `quoteHtml` ("" if removed) is a
  // preserved leading blockquote. Optimistically rebuild the stored HTML so the
  // bubble updates at once; refetch on failure.
  async function editMsg(cid: string, messageId: string, text: string, quoteHtml = ""): Promise<void> {
    const esc = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const content = (quoteHtml || "") + "<p>" + esc.replace(/\n/g, "<br>") + "</p>";
    patchMsg(messageId, (m) => ({ ...m, content, edited: true }));
    const res = await editMessage(cid, messageId, text, quoteHtml);
    if (!res.ok) { refetchMsgs(); flash("Edit failed (" + res.reason + ")"); }
  }

  async function openInTeams(): Promise<void> {
    if (!selChat) return;
    onHide?.();
    const ok = await openNativeChat(selChat.id, selChat.title);
    if (!ok) console.info("teams-calm: chat row not rendered in Teams sidebar:", selChat.title);
  }

  const openProfile = useCallback((mri: string): void => { if (mri) setProfileMri(mri); }, []);

  // Resolve a person's UPN (email) for Teams deep links.
  const upnOf = useCallback((mri: string): string => {
    const p = profile(mri);
    return p.email || (String(mri || "").match(/[^:]+@[^:]+/) || [""])[0];
  }, []);

  // New chat dialog: null = closed. `draft` = Teams already shows an empty new
  // chat with exactly `people` (so the dialog asks for the first message).
  const [newChat, setNewChat] = useState<null | { people: PeopleHit[]; draft: boolean }>(null);

  const toPick = useCallback((p: PeopleHit): PickPerson => ({
    upn: p.email || upnOf(p.mri),
    oid: (String(p.mri || "").match(/^8:orgid:([0-9a-f-]{36})$/i) || ["", ""])[1],
  }), [upnOf]);

  // Select a chat once our list knows it. A chat Teams just created only shows
  // up after the next poll picks it out of Teams' local store.
  const pickWhenListed = useCallback(async (id: string, ms = 12000): Promise<boolean> => {
    for (let t = 0; t <= ms; t += 300) {
      if (chatsRef.current.some((c) => c.id === id)) { pick(id); return true; }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }, [pick]);

  // Everyone in our chats with a cached profile, for the New chat dialog's
  // instant local matches (the directory search needs a captured token).
  const knownPeople = useCallback((): PeopleHit[] => {
    const me = myMri();
    const seen = new Set<string>();
    const out: PeopleHit[] = [];
    for (const c of chatsRef.current) {
      if (c.kind !== "chat") continue;
      for (const mri of c.members) {
        if (mri === me || seen.has(mri) || !/^8:orgid:/.test(mri)) continue;
        seen.add(mri);
        const p = profile(mri);
        if (p.displayName) out.push({ mri, displayName: p.displayName, email: p.email || "", jobTitle: p.jobTitle || "" });
      }
    }
    return out;
  }, []);

  // Send `text` into an existing chat: chatsvc first, Teams' composer as fallback.
  const sendInto = useCallback(async (id: string, title: string, text: string): Promise<boolean> => {
    let r = await sendRemote(id, text, null, []);
    if (!r.ok && r.reason === "no-token") r = await sendMessage(id, title, text);
    if (!r.ok) flash("Opened the chat, but the message wasn't sent (" + r.reason + ")", 5000);
    return r.ok;
  }, [flash]);

  // Start or open a chat with one or more people the way the stock UI does:
  // Teams' own New message + people picker (send.ts openNativeNewChat). Teams
  // decides whether a chat with exactly these people exists; if not, it shows
  // an empty draft that its first send creates (send.ts sendNativeDraft). The
  // overlay stays up and selects the chat once it is in our list.
  const startNewChat = useCallback(async (people: PeopleHit[], text: string): Promise<NewChatOutcome> => {
    const ppl = people.map(toPick);
    const missing = people.find((_, i) => !ppl[i].upn && !ppl[i].oid);
    if (missing) return { kind: "error", message: "No email on file for " + (missing.displayName || "this person") + "." };
    const opened = async (id: string): Promise<NewChatOutcome> => {
      setNewChat(null);
      const known = chatsRef.current.find((c) => c.id === id);
      if (known) pick(id);
      if (text) await sendInto(id, known?.title || "", text);
      if (!known && !(await pickWhenListed(id))) flash("Chat opened in Teams. It shows up here shortly.", 4000);
      return { kind: "done" };
    };
    // A chat we list whose members aren't exactly these people (e.g. the 1:1
    // Teams shows mid-pick) is not the one asked for.
    const want = new Set(people.map((p) => p.mri));
    const wrongChat = (id: string): boolean => {
      const c = chatsRef.current.find((x) => x.id === id);
      if (!c || c.kind !== "chat") return false;
      const got = c.members.filter((m) => m !== myMri());
      return got.length !== want.size || got.some((m) => !want.has(m));
    };
    // A 1:1 we already list needs no trip through Teams.
    if (people.length === 1) {
      const dm = chatsRef.current.find((c) => c.kind === "chat" && c.members.length === 1 && c.members[0] === people[0].mri);
      if (dm) return opened(dm.id);
    }
    if (text) {
      // Teams may already show the draft for these people (dialog's 2nd step).
      let r = await sendNativeDraft(ppl, text);
      if (!r.ok && r.reason === "draft-changed") {
        const o = await openNativeNewChat(ppl);
        if (!o.ok) return { kind: "error", message: "Couldn't open the chat in Teams (" + o.reason + ")" };
        if (o.id && !wrongChat(o.id)) return opened(o.id);
        r = await sendNativeDraft(ppl, text);
      }
      if (!r.ok) return { kind: "error", message: "Not sent (" + r.reason + ")" };
      setNewChat(null);
      if (!r.id || !(await pickWhenListed(r.id))) flash("Chat created in Teams. It shows up here shortly.", 4000);
      return { kind: "done" };
    }
    const o = await openNativeNewChat(ppl);
    if (!o.ok) return { kind: "error", message: "Couldn't open the chat in Teams (" + o.reason + ")" };
    if (o.id && !wrongChat(o.id)) return opened(o.id);
    return { kind: "draft" };
  }, [toPick, pick, sendInto, pickWhenListed, flash]);

  // "Message" on a profile: open the 1:1 (see startNewChat). A brand-new one
  // opens the New chat dialog on Teams' draft to take the first message.
  const startDirect = useCallback(async (mri: string): Promise<void> => {
    const p = profile(mri);
    const hit: PeopleHit = { mri, displayName: p.displayName || "", email: upnOf(mri), jobTitle: p.jobTitle || "" };
    const r = await startNewChat([hit], "");
    if (r.kind === "draft") setNewChat({ people: [hit], draft: true });
    else if (r.kind === "error") flash(r.message, 4000);
  }, [startNewChat, upnOf, flash]);

  // Place an audio/video call the way the stock UI does: open the chat in Teams
  // and press its own header call button (send.ts startNativeCall). A person is
  // called through their 1:1 chat. No deep-link fallback: navigating to a
  // teams.microsoft.com/l/ link replaces the Teams page with the web launcher.
  const startCall = useCallback(async (mris: string[], kind: "audio" | "video", chat?: Chat): Promise<void> => {
    const target = chat || (mris.length === 1
      ? chatsRef.current.find((c) => c.kind === "chat" && c.members.length === 1 && c.members[0] === mris[0])
      : undefined);
    if (!target) { flash("No 1:1 chat with this person yet — start one to call them.", 4000); return; }
    // The overlay stays up: Teams' buttons are clicked underneath it, and the
    // call-window guard (mount.tsx) hides the overlay wherever the call shows.
    const res = await startNativeCall(target.id, target.title, kind);
    if (!res.ok) flash("Couldn't start the call (" + res.reason + ")", 4000);
  }, [flash]);

  // Start a quote-reply: remember the target message and focus the composer.
  const onQuote = useCallback((m: Msg): void => {
    setQuote({ id: m.id, from: m.from || (m.mine ? "You" : "Unknown"), text: oneLine(splitQuote(m.content).body).slice(0, 280), time: m.time, fromMri: m.fromMri });
    requestAnimationFrame(() => composer.current?.focus());
  }, []);

  // Jump to a quoted message: scroll it into view and flash a highlight. If it's
  // not in the DOM (scrolled out / not paged in yet), page older until found.
  const onJumpTo = useCallback((mid: string): void => {
    const target = String(mid);
    const tryScroll = (): boolean => {
      const el = scroller.current?.querySelector(`.tc-msg[data-mid="${CSS.escape(target)}"]`);
      if (!el) return false;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("tc-flash");
      setTimeout(() => el.classList.remove("tc-flash"), 1400);
      return true;
    };
    if (tryScroll()) return;
    // Not loaded: page older up to a few times, then scroll.
    let n = 0;
    const pump = async (): Promise<void> => {
      if (n++ > 12 || noMore.current) return;
      await loadOlder();
      requestAnimationFrame(() => { if (!tryScroll()) pump(); });
    };
    pump();
  }, [loadOlder]);

  // Set a chat's read/unread state (used by the right-click menu). Optimistic;
  // reverts on failure. Writes the read pointer to Teams (syncs all devices).
  const setChatUnread = useCallback(async (chat: Chat, wantUnread: boolean): Promise<void> => {
    const id = chat.id;
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: wantUnread } : c)));
    const res = wantUnread ? await markUnread(id, chat.time) : await markRead(id, chat.time);
    if (!res.ok) {
      setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: !wantUnread } : c)));
      flash("Couldn't change read state (" + res.reason + ")");
    }
  }, [flash]);

  // Hide or unhide a chat (right-click menu). Optimistic; reverts on failure.
  const setHidden = useCallback(async (chat: Chat, hidden: boolean): Promise<void> => {
    const id = chat.id;
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, hidden } : c)));
    const res = await setChatHidden(id, hidden);
    if (!res.ok) {
      setChats((cs) => cs.map((c) => (c.id === id ? { ...c, hidden: !hidden } : c)));
      flash("Couldn't " + (hidden ? "hide" : "unhide") + " chat (" + res.reason + ")");
    } else if (hidden) flash("Chat hidden. Search finds it; a new message brings it back.", 4000);
  }, [flash]);

  // Open the right-click menu for a chat row.
  const openMenu = useCallback((e: MouseEvent, chat: Chat): void => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, chat });
  }, []);
  // Close the menu on any click, scroll, Escape, or resize.
  useEffect(() => {
    if (!menu) return;
    // Capture phase runs before the menu's own handlers, so ignore events that
    // start inside it; otherwise mousedown unmounts the item before its click.
    const close = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest("#tc-root .tc-menu")) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  // Close the emoji picker on any outside click, scroll, Escape, or resize. The
  // capture-phase handler runs before React's handlers, so it skips events that
  // start inside the picker or its toggle button itself.
  useEffect(() => {
    if (!emojiOpen) return;
    const close = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest("#tc-root .tc-emoji-pop, #tc-root .tc-emoji-btn")) return;
      setEmojiOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setEmojiOpen(false); };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [emojiOpen]);

  // Every chat the current user shares with `mri`: 1:1s and group chats whose
  // member list includes that MRI. Newest first (chats is already sorted).
  const sharedChats = useMemo(() => {
    if (!profileMri) return [];
    return chats.filter((c) => (c.members || []).includes(profileMri));
  }, [chats, profileMri]);

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
  const myPending = pending.filter((p) => p.chatId === sel);

  // In-conversation search: filter the rendered messages to those whose text
  // (or sender) matches the query. Day separators and grouping recompute over
  // the filtered set so the result reads naturally.
  const mq = msgSearchOpen ? msgSearch.toLowerCase().trim() : "";
  const visible = mq
    ? shown.filter((m) => !m.deleted && (
        messageText(m).toLowerCase().includes(mq) ||
        (m.from || "").toLowerCase().includes(mq)
      ))
    : shown;

  const body: JSX.Element[] = [];
  let prev: Msg | null = null;
  for (const m of visible) {
    if (!prev || new Date(prev.time).toDateString() !== new Date(m.time).toDateString()) {
      body.push(
        <div key={"d" + m.id} className="tc-day"><span>{fmtDay(m.time)}</span></div>
      );
      prev = null;
    }
    const first =
      !prev ||
      prev.fromMri !== m.fromMri ||
      m.time - prev.time > GROUP_GAP_MS ||
      (selIsChannel && (prev.rootId !== m.rootId || !m.isReply));
    if (selIsChannel && !m.isReply && prev) body.push(<div key={"s" + m.id} className="tc-thread-sep" />);
    body.push(<Message key={m.id} m={m} first={first} channel={selIsChannel} cid={sel!} onReact={reactToMsg} onDelete={deleteMsg} onUndo={undoDeleteMsg} onEdit={editMsg} onOpenProfile={openProfile} onQuote={onQuote} onJumpTo={onJumpTo} />);
    prev = m;
  }

  return (
    <>
      <aside className="tc-side">
        <div className="tc-side-head">
          <h1>Teams Calm</h1>
          <button className="tc-side-btn" onClick={() => setCompact((c) => !c)}
            title={compact ? "Show message previews" : "Compact list"} aria-label={compact ? "Show message previews" : "Compact list"}>
            {compact ? <Rows2 size={16} /> : <Rows3 size={16} />}
          </button>
          <button className="tc-side-btn" onClick={() => setNewChat({ people: [], draft: false })} title="New chat" aria-label="New chat">
            <SquarePen size={16} />
          </button>
        </div>
        <div className="tc-side-tools">
          <div className="tc-search">
            <Search size={15} className="tc-search-icon" />
            <input
              ref={search}
              placeholder="Search  ⌘K"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                } else if (e.key === "Enter" && flat[0]) {
                  pick(flat[0].id);
                  setQuery("");
                  composer.current?.focus();
                }
              }}
            />
          </div>
          <button
            className={"tc-unread-pill" + (unreadOnly ? " on" : "")}
            aria-pressed={unreadOnly}
            onClick={() => setUnreadFilter(!unreadOnly)}
            title="Only unread conversations  ⌥U · next unread ⌥⇧↓"
          >
            Unread{unreadCount ? <span className="tc-unread-n">{unreadCount}</span> : null}
          </button>
        </div>
        <div className="tc-list">
          {error ? (
            <div className="tc-note">
              Can't read Teams' local data in this window.
              <br />
              <small>{error}</small>
            </div>
          ) : null}
          {sections.map((s) => (
            <Section key={s.id} id={s.id} title={s.title} rows={s.rows} sel={sel} compact={compact}
              capped={s.capped} groupByTeam={s.groupByTeam} defaultCollapsed={s.defaultCollapsed}
              onPick={pick} onOpenProfile={openProfile} onMenu={openMenu} />
          ))}
          {!error && !sections.length ? (
            <div className="tc-list-empty">
              {query ? <>No chats match “{query}”.</> : unreadOnly ? (
                <div className="tc-caught-up">
                  <CheckCheck size={28} className="tc-caught-up-icon" />
                  <strong>All caught up</strong>
                  <span>No unread conversations.</span>
                  <button className="tc-more" onClick={() => setUnreadFilter(false)}>Show all conversations</button>
                </div>
              ) : "No conversations yet."}
            </div>
          ) : null}
        </div>
        <MeBar onSwitchToTeams={onHide} onError={(m) => flash(m, 4000)} />
      </aside>

      <main className="tc-main">
        {selChat ? (
          <>
            <div className="tc-main-head">
              {selChat.isChannel ? (
                <div className="tc-av tc-hash"><Hash size={18} /></div>
              ) : (
                <Avatar name={selChat.title} uri={avatarUri(selChat.avatarMri)} mri={selChat.avatarMri} status={statusOf(selChat.avatarMri)} onOpen={openProfile} />
              )}
              <div className="tc-head-text">
                <span className="tc-name">{selChat.title}</span>
                {headSub ? <span className="tc-sub">{headSub}</span> : null}
              </div>
              <button
                className={"tc-ghost tc-icon-only" + (msgSearchOpen ? " on" : "")}
                onClick={() => setMsgSearchOpen((o) => !o)}
                title="Search in this chat"
                aria-label="Search in this chat"
              >
                <Search size={15} />
              </button>
              {callable ? (
                <>
                  <button className="tc-ghost tc-icon-only" onClick={() => void startCall(selChat.members, "audio", selChat)} title={callLabel("Audio call")} aria-label={callLabel("Audio call")}>
                    <Phone size={15} />
                  </button>
                  <button className="tc-ghost tc-icon-only" onClick={() => void startCall(selChat.members, "video", selChat)} title={callLabel("Video call")} aria-label={callLabel("Video call")}>
                    <Video size={15} />
                  </button>
                </>
              ) : null}
            </div>
            {msgSearchOpen ? (
              <div className="tc-msgsearch">
                <Search size={14} className="tc-search-icon" />
                <input
                  autoFocus
                  placeholder="Search in this chat"
                  value={msgSearch}
                  onChange={(e) => setMsgSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setMsgSearch(""); setMsgSearchOpen(false); }
                  }}
                />
                {msgSearch ? (
                  <span className="tc-msgsearch-n">{visible.length} match{visible.length === 1 ? "" : "es"}</span>
                ) : null}
                <button className="tc-msgsearch-x" onClick={() => { setMsgSearch(""); setMsgSearchOpen(false); }} aria-label="Close search"><X size={14} /></button>
              </div>
            ) : null}
            <div className="tc-msgs-wrap">
              {stickyDay && !mq ? (
                <div className="tc-day-sticky"><span>{stickyDay}</span></div>
              ) : null}
              <div className="tc-msgs" ref={scroller} onScroll={onScroll}>
              {mq && !body.length ? (
                <div className="tc-empty"><p className="tc-sub">No messages match “{msgSearch}”.</p></div>
              ) : null}
              {body}
              {myPending.map((p) => (
                <div key={p.key} className="tc-msg first pending">
                  <Avatar name="You" />
                  <div className="tc-msg-body">
                    <div className="tc-msg-meta">
                      <span className="who">You</span>
                      <span className="when">sending…</span>
                    </div>
                    <div className="tc-msg-content">{p.text}</div>
                  </div>
                </div>
              ))}
              {msgs.id === sel && !msgs.loaded && !myPending.length ? (
                <div className="tc-empty"><p className="tc-sub">Loading…</p></div>
              ) : null}
              {msgs.loaded && msgs.failed && msgs.id === sel && !shown.length && !myPending.length ? (
                <div className="tc-empty">
                  <p>Couldn't load this conversation.</p>
                  <p className="tc-sub">Teams' backend didn't answer. It may need a moment after Teams starts.</p>
                  <div className="tc-empty-actions">
                    <button className="tc-ghost" onClick={refetchMsgs}><RotateCw size={14} /> Retry</button>
                    <button className="tc-ghost" onClick={openInTeams}><ExternalLink size={14} /> Open in Teams</button>
                  </div>
                </div>
              ) : msgs.loaded && msgs.id === sel && !shown.length && !myPending.length ? (
                <div className="tc-empty">
                  <p>No messages in this chat yet.</p>
                  <button className="tc-ghost" onClick={openInTeams}>Open in Teams</button>
                </div>
              ) : null}
              </div>
            </div>
            <div className="tc-composer">
              {/* Floats above the box so typing never shifts the layout. */}
              {typingLabel ? <div className="tc-typing" aria-live="polite">{typingLabel}…</div> : null}
              {!atBottom ? (
                <button className="tc-scroll-newest" onClick={scrollToBottom} title="Jump to newest" aria-label="Jump to newest">
                  <ArrowDown size={16} />
                </button>
              ) : null}
              {quote ? (
                <div className="tc-quote-chip">
                  <Reply size={13} className="tc-quote-chip-icon" />
                  <div className="tc-quote-chip-body">
                    <span className="tc-quote-chip-from">{quote.from}</span>
                    <span className="tc-quote-chip-text">{quote.text || "…"}</span>
                  </div>
                  <button className="tc-quote-chip-x" onClick={() => setQuote(null)} aria-label="Cancel quote"><X size={13} /></button>
                </div>
              ) : null}
              {emojiOpen ? (
                <div className="tc-emoji-pop" onMouseDown={(e) => e.stopPropagation()}>
                  <EmojiPicker onPick={(em) => { insertAtCaret(em); setEmojiOpen(false); }} />
                </div>
              ) : null}
              {atOpen && atCandidates.length ? (
                <div className="tc-at-pop" onMouseDown={(e) => e.stopPropagation()}>
                  {atCandidates.map((c) => (
                    <button
                      key={c.mri}
                      className="tc-at-opt"
                      onClick={() => pickMention(c)}
                    >
                      <Avatar name={c.name} uri={avatarUri(c.mri)} mri={c.mri} small />
                      <span className="tc-at-name">{c.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="tc-composer-box">
                <button
                  className="tc-emoji-btn"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => setEmojiOpen((o) => !o)}
                  title="Emoji"
                  aria-label="Emoji"
                  aria-expanded={emojiOpen}
                >
                  <Smile size={18} />
                </button>
                <textarea
                  ref={composer}
                  rows={1}
                  placeholder={"Message " + (selChat.isChannel ? "#" : "") + selChat.title}
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (atOpen && atCandidates.length) {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        pickMention(atCandidates[0]);
                        return;
                      }
                      if (e.key === "Escape") { e.preventDefault(); setAtOpen(false); return; }
                    }
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      doSend();
                    }
                  }}
                />
                <button
                  className="tc-send"
                  disabled={!draft.trim()}
                  onClick={doSend}
                  title="Send (Enter)"
                  aria-label="Send"
                >
                  <Send size={16} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="tc-drag tc-main-drag" />
            <div className="tc-empty">{error ? "No Teams data here." : "Select a chat"}</div>
          </>
        )}
      </main>

      {newChat ? (
        <NewChat
          initial={newChat.people}
          initialDraft={newChat.draft}
          known={knownPeople}
          onStart={startNewChat}
          onClose={() => setNewChat(null)}
        />
      ) : null}

      {profileMri ? (
        <ProfilePanel
          mri={profileMri}
          chats={sharedChats}
          sel={sel}
          onPick={(id) => { pick(id); setProfileMri(null); }}
          onClose={() => setProfileMri(null)}
          onMessage={() => { void startDirect(profileMri); setProfileMri(null); }}
          onCall={(kind) => { void startCall([profileMri], kind); setProfileMri(null); }}
        />
      ) : null}

      {menu ? (
        <div
          className="tc-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 130) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Channels: Teams' unread bookmark op is only known for chats. */}
          {menu.chat.isChannel && !menu.chat.unread ? null : (
            <button
              className="tc-menu-item"
              onClick={() => { setChatUnread(menu.chat, !menu.chat.unread); setMenu(null); }}
            >
              {menu.chat.unread ? <MailOpen size={14} /> : <Mail size={14} />}
              {menu.chat.unread ? "Mark as read" : "Mark as unread"}
            </button>
          )}
          {menu.chat.isChannel ? null : (
            <button
              className="tc-menu-item"
              onClick={() => { setHidden(menu.chat, !menu.chat.hidden); setMenu(null); }}
            >
              {menu.chat.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
              {menu.chat.hidden ? "Unhide" : "Hide"}
            </button>
          )}
        </div>
      ) : null}

      {toast ? <div className="tc-toast">{toast}</div> : null}
    </>
  );
}
