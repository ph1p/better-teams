import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from "react";
import {
  deleteMessage, editMessage, fetchOlderRemote, listChats, listMessages, loadProfiles,
  markRead, markUnread, myMri, primeRemote, profile, searchPeople, sendRemote, setReaction, splitQuote, undoDelete,
} from "../teamsData";
import { openNativeChat, sendMessage } from "../send";
import {
  Send, Search, Hash, MailOpen, Mail, ExternalLink, X, Reply, Phone, Video, RotateCw,
  ArrowDown, Smile,
} from "lucide-react";
import { EmojiPicker } from "./shared/EmojiPicker";
import { Avatar } from "./shared/Avatar";
import { Section } from "./sidebar/Section";
import { MeBar } from "./sidebar/MeBar";
import { Message } from "./chat/Message";
import { ProfilePanel } from "./profile/ProfilePanel";
import { avatarUri, fmtDay, htmlToText, messageText, oneLine } from "./lib/format";
import { isIdle, onTeamsChange } from "./lib/live";
import { usePresence } from "./lib/presence";
import { GROUP_GAP_MS, INITIAL_REMOTE, POLL_MS } from "./lib/constants";
import type { Chat, Message as Msg, Quote } from "../types";
import type { MentionPick } from "../mentions";

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
const chatSig = (list: Chat[]): string => list.map((c) => `${c.id}:${c.time}:${c.unread}:${c.title}`).join("|");

export default function App({ onHide }: { onHide?: () => void }): JSX.Element {
  const { statusOf } = usePresence();
  const [chats, setChats] = useState<Chat[]>([]);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<MsgBucket>({ id: null, list: [], loaded: false });
  const [older, setOlder] = useState<OldBucket>({ id: null, list: [] });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [query, setQuery] = useState("");
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
  const selIsChannel = !!selChat?.isChannel;

  // Messages for the selected chat, polled.
  useEffect(() => {
    if (!sel) return;
    let alive = true;
    lastMsgSig.current = "";
    nullTicks.current = 0;
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
    return () => {
      alive = false;
      clearInterval(t);
      offLive();
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
      const page = await fetchOlderRemote(cid!, selIsChannel);
      if (cid !== sel) return; // switched chat mid-fetch
      if (!page) { noMore.current = true; return; }
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

  const sections = useMemo<Array<[string, Chat[]]>>(() => {
    const q = query.toLowerCase().trim();
    const list = q
      ? chats.filter((c) => (c.title + " " + c.team).toLowerCase().includes(q))
      : chats;
    const pinned = (c: Chat): boolean => c.favorite || c.pinned;
    return ([
      ["Favorites", list.filter(pinned)],
      ["Chats", list.filter((c) => !pinned(c) && (c.kind === "chat" || c.kind === "notes"))],
      ["Channels", list.filter((c) => !pinned(c) && c.kind === "channel")],
      ["Meetings", list.filter((c) => !pinned(c) && c.kind === "meeting")],
    ] as Array<[string, Chat[]]>).filter(([, rows]) => rows.length);
  }, [chats, query]);
  const flat = useMemo(() => sections.flatMap(([, rows]) => rows), [sections]);
  const unreadCount = useMemo(() => chats.filter((c) => c.unread).length, [chats]);

  const chatsRef = useRef<Chat[]>([]);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  const pick = useCallback((id: string): void => {
    setSel(id);
    // Opening a chat marks it read in Teams, same as the native client. Fire the
    // write and flip our flag only when the chat was actually unread.
    const hit = chatsRef.current.find((c) => c.id === id);
    if (hit && hit.unread) {
      setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: false } : c)));
      markRead(id, hit.time).then((res) => {
        if (!res.ok) flash("Couldn't mark as read (" + res.reason + ")");
      });
    }
    requestAnimationFrame(() => {
      document.querySelector(`#tc-root .tc-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }, [flash]);

  // Keyboard: ⌘K search, ⌥↑/⌥↓ previous/next chat, Esc leaves search.
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
  }, [flat, sel, pick, msgSearchOpen]);

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
  const refetchMsgs = (): void => { setMsgs((s) => ({ ...s, loaded: false, failed: false })); lastMsgSig.current = ""; nullTicks.current = 0; };

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

  // Start (or open) a 1:1 chat with a person when no shared DM exists yet. Hands
  // off to the native Teams client via its chat deep link, keyed by email.
  const startDirect = useCallback((mri: string): void => {
    const upn = upnOf(mri);
    if (!upn) { flash("No email on file for this person — open them in Teams to start a chat."); return; }
    onHide?.();
    location.href = "https://teams.microsoft.com/l/chat/0/0?users=" + encodeURIComponent(upn);
  }, [flash, onHide, upnOf]);

  // Place an audio/video call via the native Teams call deep link.
  const startCall = useCallback((mri: string, kind: "audio" | "video"): void => {
    const upn = upnOf(mri);
    if (!upn) { flash("No email on file for this person — can't start a call."); return; }
    onHide?.();
    const base = "https://teams.microsoft.com/l/call/0/0?users=" + encodeURIComponent(upn);
    location.href = kind === "video" ? base + "&withVideo=true" : base;
  }, [flash, onHide, upnOf]);

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

  // Open the right-click menu for a chat row.
  const openMenu = useCallback((e: MouseEvent, chat: Chat): void => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, chat });
  }, []);
  // Close the menu on any click, scroll, Escape, or resize.
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
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
  // picker and its toggle button stop mousedown propagation, so clicks inside
  // them don't reach this capture-phase handler.
  useEffect(() => {
    if (!emojiOpen) return;
    const close = (): void => setEmojiOpen(false);
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
        </div>
        {unreadCount ? (
          <button
            className="tc-unread-link"
            title="Jump to the newest unread conversation"
            onClick={() => { const u = flat.find((c) => c.unread); if (u) pick(u.id); }}
          >
            <span className="tc-unread-link-label">Unread</span>
            <span className="tc-unread-link-n">{unreadCount}</span>
          </button>
        ) : null}
        <div className="tc-search">
          <Search size={15} className="tc-search-icon" />
          <input
            ref={search}
            placeholder="Search chats  ⌘K"
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
        <div className="tc-list">
          {error ? (
            <div className="tc-note">
              Can't read Teams' local data in this window.
              <br />
              <small>{error}</small>
            </div>
          ) : null}
          {sections.map(([title, rows]) => (
            <Section key={title} title={title} rows={rows} sel={sel} onPick={pick} onOpenProfile={openProfile} onMenu={openMenu} />
          ))}
          {!error && !sections.length ? (
            <div className="tc-list-empty">
              {query ? <>No chats match “{query}”.</> : "No conversations yet."}
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
                {selChat.team ? <span className="tc-sub">{selChat.team}</span> : null}
              </div>
              <button
                className={"tc-ghost tc-icon-only" + (msgSearchOpen ? " on" : "")}
                onClick={() => setMsgSearchOpen((o) => !o)}
                title="Search in this chat"
                aria-label="Search in this chat"
              >
                <Search size={15} />
              </button>
              {selChat.avatarMri ? (
                <>
                  <button className="tc-ghost tc-icon-only" onClick={() => startCall(selChat.avatarMri, "audio")} title="Audio call" aria-label="Audio call">
                    <Phone size={15} />
                  </button>
                  <button className="tc-ghost tc-icon-only" onClick={() => startCall(selChat.avatarMri, "video")} title="Video call" aria-label="Video call">
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
              <div className="tc-composer-hint">
                <span>Enter to send · Shift+Enter newline</span>
                <span className="tc-kb">⌥⌘T Teams · ⌘K search · ⌥↑↓ switch</span>
              </div>
            </div>
          </>
        ) : (
          <div className="tc-empty">{error ? "No Teams data here." : "Select a chat"}</div>
        )}
      </main>

      {profileMri ? (
        <ProfilePanel
          mri={profileMri}
          chats={sharedChats}
          sel={sel}
          onPick={(id) => { pick(id); setProfileMri(null); }}
          onClose={() => setProfileMri(null)}
          onMessage={() => { startDirect(profileMri); setProfileMri(null); }}
          onCall={(kind) => { startCall(profileMri, kind); setProfileMri(null); }}
        />
      ) : null}

      {menu ? (
        <div
          className="tc-menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 100) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="tc-menu-item"
            onClick={() => { setChatUnread(menu.chat, !menu.chat.unread); setMenu(null); }}
          >
            {menu.chat.unread ? <MailOpen size={14} /> : <Mail size={14} />}
            {menu.chat.unread ? "Mark as read" : "Mark as unread"}
          </button>
        </div>
      ) : null}

      {toast ? <div className="tc-toast">{toast}</div> : null}
    </>
  );
}
