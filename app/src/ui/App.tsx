import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from "react";
import { markRead } from "../teamsData";
import { openNativeChat } from "../send";
import { Sidebar } from "./sidebar/Sidebar";
import { ChatMenu, type Menu } from "./sidebar/ChatMenu";
import { buildSections } from "./sidebar/sections";
import { NewChat } from "./sidebar/NewChat";
import { ChatHeader, MessageSearchBar } from "./chat/ChatHeader";
import { Timeline } from "./chat/Timeline";
import { Composer } from "./chat/Composer";
import { ProfilePanel } from "./profile/ProfilePanel";
import { NotesPanel } from "./notes/NotesPanel";
import { FileViewer } from "./shared/FileViewer";
import { messageText } from "./lib/format";
import { usePref } from "./lib/prefs";
import { useToast } from "./lib/toast";
import type { Chat } from "../types";
import { useChatList } from "./hooks/useChatList";
import { useMessages } from "./hooks/useMessages";
import { useComposerState } from "./hooks/useComposerState";
import { useChatActions } from "./hooks/useChatActions";
import { useShortcuts } from "./hooks/useShortcuts";

export default function App({ onHide }: { onHide?: () => void }): JSX.Element {
  const [toast, flash] = useToast();
  const { chats, setChats, chatsRef, error, sel, setSel } = useChatList();
  const [query, setQuery] = useState("");
  // Sidebar "Unread" filter. Chats opened while it is on stay listed (keep) so
  // they don't vanish the moment they are read; leaving the filter drops them.
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Sidebar density: compact one-line rows (default) or name + preview.
  const [compact, setCompact] = usePref<boolean>("compact", true);
  const [keep, setKeep] = useState<Set<string>>(() => new Set());
  const [profileMri, setProfileMri] = useState<string | null>(null);
  // Notes drawer (local scratchpad). Open on first run, then
  // remembers whether it was left open or closed.
  const [notesOpen, setNotesOpen] = usePref<boolean>("notesOpen", true);
  // Right-click chat menu: {x, y, chat} or null.
  const [menu, setMenu] = useState<Menu | null>(null);
  // In-conversation message search: open flag + query string.
  const [msgSearch, setMsgSearch] = useState("");
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  // Channel threads whose older replies are expanded (by root id).
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(new Set());
  // message id -> thread root id for the rendered channel, so jump-to can
  // expand a collapsed thread before scrolling.
  const msgRoot = useRef<Map<string, string>>(new Map());
  const search = useRef<HTMLInputElement>(null);

  const selChat = chats.find((c) => c.id === sel);
  const selIsChannel = !!selChat?.isChannel;
  const m = useMessages(sel, selChat, flash);
  const cs = useComposerState(sel, selChat, m, flash);

  // A new conversation starts with search closed and threads collapsed.
  useEffect(() => {
    if (!sel) return;
    setMsgSearch("");
    setMsgSearchOpen(false);
    setOpenThreads(new Set());
  }, [sel, selIsChannel]);

  const sections = useMemo(() => buildSections(chats, query, unreadOnly, keep), [chats, query, unreadOnly, keep]);
  const selfChat = useMemo(() => chats.find((c) => c.kind === "notes"), [chats]);
  // Bottom slot shows the self-chat only in the normal (sectioned) view; search
  // and the Unread filter list it inline like any other chat.
  const selfSlot = !query.trim() && !unreadOnly ? selfChat : undefined;
  // Keyboard order follows the screen: sections, then the bottom slot.
  const flat = useMemo(
    () => [...sections.flatMap((s) => s.rows), ...(selfSlot ? [selfSlot] : [])],
    [sections, selfSlot],
  );
  const unreadCount = useMemo(() => chats.filter((c) => c.unread && !c.hidden).length, [chats]);

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
  }, [flash, unreadOnly, setSel, setChats, chatsRef]);

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
  }, [sel, pick, chatsRef]);

  const closeMsgSearch = (): void => { setMsgSearch(""); setMsgSearchOpen(false); };
  const toggleNotes = (): void => { setProfileMri(null); setNotesOpen((o) => !o); };

  useShortcuts({
    flat, sel, pick, searchRef: search, msgSearchOpen,
    openMsgSearch: () => setMsgSearchOpen(true), closeMsgSearch, toggleNotes, unreadOnly, setUnreadFilter,
  });

  const a = useChatActions({ sel, chatsRef, setChats, pick, flash });

  async function openInTeams(): Promise<void> {
    if (!selChat) return;
    onHide?.();
    const ok = await openNativeChat(selChat.id, selChat.title);
    if (!ok) console.info("teams-calm: chat row not rendered in Teams sidebar:", selChat.title);
  }

  const openProfile = useCallback((mri: string): void => { if (mri) setProfileMri(mri); }, []);

  const toggleThread = useCallback((rootId: string): void => {
    setOpenThreads((s) => {
      const n = new Set(s);
      if (n.has(rootId)) n.delete(rootId); else n.add(rootId);
      return n;
    });
  }, []);

  // Jump to a quoted message: scroll it into view and flash a highlight. If it's
  // not in the DOM (scrolled out / not paged in yet), page older until found.
  const { scroller, noMore, loadOlder } = m;
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
    // Hidden in a collapsed channel thread: expand it, then scroll.
    const root = msgRoot.current.get(target);
    if (root) {
      setOpenThreads((s) => new Set(s).add(root));
      requestAnimationFrame(() => requestAnimationFrame(() => { tryScroll(); }));
      return;
    }
    // Not loaded: page older up to a few times, then scroll.
    let n = 0;
    const pump = async (): Promise<void> => {
      if (n++ > 12 || noMore.current) return;
      await loadOlder();
      requestAnimationFrame(() => { if (!tryScroll()) pump(); });
    };
    pump();
  }, [loadOlder, scroller, noMore]);

  // Open the right-click menu for a chat row.
  const openMenu = useCallback((e: MouseEvent, chat: Chat): void => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, chat });
  }, []);

  // Every chat the current user shares with `mri`: 1:1s and group chats whose
  // member list includes that MRI. Newest first (chats is already sorted).
  const sharedChats = useMemo(() => {
    if (!profileMri) return [];
    return chats.filter((c) => (c.members || []).includes(profileMri));
  }, [chats, profileMri]);

  // In-conversation search: filter the rendered messages to those whose text
  // (or sender) matches the query. Day separators and grouping recompute over
  // the filtered set so the result reads naturally.
  const mq = msgSearchOpen ? msgSearch.toLowerCase().trim() : "";
  const visible = mq
    ? m.shown.filter((x) => !x.deleted && (
        messageText(x).toLowerCase().includes(mq) ||
        (x.from || "").toLowerCase().includes(mq)
      ))
    : m.shown;

  return (
    <>
      <Sidebar
        sections={sections} selfSlot={selfSlot} sel={sel} error={error}
        compact={compact} onToggleCompact={() => setCompact((c) => !c)}
        onNewChat={() => a.setNewChat({ people: [], draft: false })}
        query={query} onQuery={setQuery} searchRef={search}
        onSearchEnter={() => {
          if (!flat[0]) return;
          pick(flat[0].id);
          setQuery("");
          cs.composer.current?.focus();
        }}
        unreadOnly={unreadOnly} unreadCount={unreadCount} onUnreadFilter={setUnreadFilter}
        onPick={pick} onOpenProfile={openProfile} onMenu={openMenu}
        onHide={onHide} onError={(msg) => flash(msg, 4000)}
      />

      <main className="tc-main">
        {selChat ? (
          <>
            <ChatHeader
              chat={selChat}
              searchOpen={msgSearchOpen} onToggleSearch={() => setMsgSearchOpen((o) => !o)}
              notesOpen={notesOpen} onToggleNotes={toggleNotes}
              onOpenProfile={openProfile}
              onJoinCall={(rootId) => void a.joinCall(rootId)}
              onMeetNow={() => void a.meetNow()}
              onCall={(mris, kind, chat) => void a.startCall(mris, kind, chat)}
            />
            {msgSearchOpen ? (
              <MessageSearchBar query={msgSearch} onQuery={setMsgSearch} matches={visible.length} onClose={closeMsgSearch} />
            ) : null}
            <div className="tc-msgs-wrap">
              {m.stickyDay && !mq ? (
                <div className="tc-day-sticky"><span>{m.stickyDay}</span></div>
              ) : null}
              <div className="tc-msgs" ref={m.scroller} onScroll={m.onScroll}>
                <Timeline
                  visible={visible} cid={selChat.id} chat={selChat} channel={selIsChannel}
                  pending={m.myPending} mq={mq} searchText={msgSearch}
                  openThreads={openThreads} onToggleThread={toggleThread}
                  replyingTo={cs.threadTo?.rootId} msgRoot={msgRoot}
                  loading={m.loading} ready={m.ready} failed={m.failed} empty={!m.shown.length}
                  onRetry={m.refetch} onOpenInTeams={() => void openInTeams()}
                  onReact={m.react} onDelete={m.remove} onUndo={m.undo} onEdit={m.edit}
                  onOpenProfile={openProfile} onQuote={cs.onQuote} onJumpTo={onJumpTo}
                  onThreadReply={cs.onThreadReply} onJoinCall={(rootId) => void a.joinCall(rootId)}
                />
              </div>
            </div>
            <Composer chat={selChat} cs={cs} atBottom={m.atBottom} onScrollToBottom={m.scrollToBottom} />
          </>
        ) : (
          <>
            <div className="tc-drag tc-main-drag" />
            <div className="tc-empty">{error ? "No Teams data here." : "Select a chat"}</div>
          </>
        )}
      </main>

      {a.newChat ? (
        <NewChat
          initial={a.newChat.people}
          initialDraft={a.newChat.draft}
          known={a.knownPeople}
          onStart={a.startNewChat}
          onClose={() => a.setNewChat(null)}
        />
      ) : null}

      {profileMri ? (
        <ProfilePanel
          mri={profileMri}
          chats={sharedChats}
          sel={sel}
          onPick={(id) => { pick(id); setProfileMri(null); }}
          onClose={() => setProfileMri(null)}
          onMessage={() => { void a.startDirect(profileMri); setProfileMri(null); }}
          onCall={(kind) => { void a.startCall([profileMri], kind); setProfileMri(null); }}
        />
      ) : null}

      {notesOpen && !profileMri ? (
        <NotesPanel
          onClose={() => setNotesOpen(false)}
        />
      ) : null}

      {menu ? (
        <ChatMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onSetUnread={(chat, unread) => void a.setChatUnread(chat, unread)}
          onSetHidden={(chat, hidden) => void a.setHidden(chat, hidden)}
        />
      ) : null}

      <FileViewer />

      {toast ? <div className="tc-toast">{toast}</div> : null}
    </>
  );
}
