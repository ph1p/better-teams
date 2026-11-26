import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { NetBanner } from "./shared/NetBanner";
import { useChanged } from "./lib/changed";
import { useLatest } from "./lib/latest";
import { forwardMessage, markRead } from "../teamsData";
import { openNativeChat } from "../send";
import { Sidebar, type InboxTab } from "./sidebar/Sidebar";
import { ChatMenu, type Menu } from "./sidebar/ChatMenu";
import { TeamChannelsMenu, type TeamMenu } from "./sidebar/TeamChannelsMenu";
import { buildSections, listed } from "./sidebar/sections";
import { NewChat } from "./sidebar/NewChat";
import { NewChannel } from "./sidebar/NewChannel";
import { ChatHeader, MessageSearchBar } from "./chat/ChatHeader";
import { Timeline } from "./chat/Timeline";
import { Composer } from "./chat/Composer";
import { ThreadPanel } from "./chat/ThreadPanel";
import { ForwardDialog } from "./chat/ForwardDialog";
import { ProfilePanel } from "./profile/ProfilePanel";
import { NotesPanel } from "./notes/NotesPanel";
import { FileViewer } from "./shared/FileViewer";
import { chatTitle, messageText } from "./lib/format";
import { usePref } from "./lib/prefs";
import { useToast } from "./lib/toast";
import type { Activity, Chat, Message as Msg } from "../types";
import type { TeamsLink } from "../teamsLinks";
import { useChatList } from "./hooks/useChatList";
import { useMessages } from "./hooks/useMessages";
import { useActivity } from "./hooks/useActivity";
import { useComposerState } from "./hooks/useComposerState";
import { useChatActions } from "./hooks/useChatActions";
import { useShortcuts } from "./hooks/useShortcuts";
import { useFollowNative } from "./hooks/useFollowNative";
import { t, useLang } from "../i18n";
import { useNameFormat } from "../names";
import { useMessageNav } from "./hooks/useMessageNav";

export default function App({ onHide }: { onHide?: () => void }) {
  // Re-render everything on a language switch; tag the overlay for screen readers.
  const uiLang = useLang();
  useNameFormat();
  useEffect(() => {
    document.getElementById("tc-root")?.setAttribute("lang", uiLang);
  }, [uiLang]);
  const [toast, flash] = useToast();
  const { chats, setChats, chatsRef, error, sel, setSel } = useChatList();
  const [query, setQuery] = useState("");
  // Sidebar "Unread" filter. Chats opened while it is on stay listed (keep) so
  // they don't vanish the moment they are read; leaving the filter drops them.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [compact, setCompact] = usePref("compact", true);
  const [keep, setKeep] = useState<Set<string>>(() => new Set());
  const [profileMri, setProfileMri] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = usePref("notesOpen", true);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [teamMenu, setTeamMenu] = useState<TeamMenu | null>(null);
  const [msgSearch, setMsgSearch] = useState("");
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  // Channel thread shown in the thread pane (its root id), or null.
  const [threadRoot, setThreadRoot] = useState<string | null>(null);
  // message id -> thread root id for the rendered channel, so jump-to can open
  // a reply's thread before scrolling to it.
  const msgRoot = useRef<Map<string, string>>(new Map());
  const search = useRef<HTMLInputElement>(null);
  const [fwd, setFwd] = useState<{ msg: Msg; from: string } | null>(null);
  // Narrow windows show either the chat list or the open chat, not both.
  // Opening a chat switches to it; the header's back button returns to the list.
  const [inChat, setInChat] = useState(false);
  useEffect(() => {
    document.getElementById("tc-root")?.classList.toggle("tc-in-chat", inChat && !!sel);
  }, [inChat, sel]);

  const selChat = chats.find((c) => c.id === sel);
  const selIsChannel = !!selChat?.isChannel;
  const selRef = useLatest(sel);
  const messages = useMessages(sel, selChat, flash);
  const cs = useComposerState(sel, selChat, messages, flash);
  const openThread = selIsChannel ? threadRoot : null;
  const ts = useComposerState(sel, selChat, messages, flash, openThread);
  // Refs pulled out, so reading the rest during render is plainly not a ref read.
  const { scroller, content, noMore, loadOlder, unstick, ...m } = messages;

  const switched = useChanged(sel + "|" + selIsChannel);
  if (switched && sel) {
    setInChat(true);
    setMsgSearch("");
    setMsgSearchOpen(false);
    setThreadRoot(null);
    setProfileMri(null);
  }

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
  const unreadCount = useMemo(() => chats.filter((c) => c.unread && listed(c)).length, [chats]);

  // Activity feed: polled always (the bell shows its unread count), listed in
  // the sidebar's Activity tab while the inbox is on.
  const feed = useActivity();
  const [inboxTab, setInboxTab] = useState<InboxTab>("unread");
  const activityShown = unreadOnly && inboxTab === "activity";
  // A feed item to scroll to once its chat has loaded.
  const pendingJump = useRef<{ cid: string; mid: string; root?: string } | null>(null);
  // Bumped per item click so the jump effect re-runs even when the chat is already open.
  const [jumpSeq, setJumpSeq] = useState(0);

  const pick = useCallback(
    (id: string) => {
      setSel(id);
      setInChat(true);
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
          flash(t().app.markReadFailed(res.reason));
        });
      }
      requestAnimationFrame(() => {
        document.querySelector(`#tc-root .tc-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
      });
    },
    [flash, unreadOnly, setSel, setChats, chatsRef],
  );

  // Turn the Unread filter on/off. Turning it on opens the newest unread chat
  // unless the open one is unread itself; an already-read open chat is not
  // carried into the filter.
  const setUnreadFilter = useCallback(
    (on: boolean) => {
      setUnreadOnly(on);
      const cur = chatsRef.current.find((c) => c.id === sel);
      setKeep(new Set(on && cur && cur.unread ? [cur.id] : []));
      if (!on || (cur && cur.unread)) return;
      const u = chatsRef.current.find((c) => c.unread && listed(c));
      if (u) {
        setKeep(new Set([u.id]));
        pick(u.id);
      }
    },
    [sel, pick, chatsRef],
  );

  const closeMsgSearch = () => {
    setMsgSearch("");
    setMsgSearchOpen(false);
  };
  // Notes and a thread share the right pane; the thread wins while open, and
  // closing it brings the notes back. The notes button always shows notes.
  const notesShown = notesOpen && !openThread;
  const toggleNotes = () => {
    setProfileMri(null);
    if (notesShown) return setNotesOpen(false);
    setThreadRoot(null);
    setNotesOpen(true);
  };

  useShortcuts({
    flat,
    sel,
    pick,
    searchRef: search,
    msgSearchOpen,
    openMsgSearch: () => setMsgSearchOpen(true),
    closeMsgSearch,
    toggleNotes,
    unreadOnly,
    setUnreadFilter,
  });

  // A chat Teams opens by itself (a notification click) opens here too, ready
  // for a reply.
  useFollowNative(sel, chats, chatsRef, (id) => {
    pick(id);
    setProfileMri(null);
    requestAnimationFrame(() => cs.composer.current?.focus());
  });

  const a = useChatActions({ sel, chatsRef, setChats, pick, flash });

  // Stable for the memoized Message rows; the source chat is read at click time.
  const onForward = useCallback(
    (msg: Msg) => {
      if (selRef.current) setFwd({ msg, from: selRef.current });
    },
    [selRef],
  );
  const doForward = useCallback(
    async (target: Chat, comment: string) => {
      if (!fwd) return null;
      const r = await forwardMessage(target.id, fwd.from, fwd.msg.id, comment);
      if (!r.ok) return t().app.forwardFailed(r.reason);
      setFwd(null);
      flash(t().app.forwarded(chatTitle(target)));
      return null;
    },
    [fwd, flash],
  );

  async function openInTeams() {
    if (!selChat) return;
    onHide?.();
    const ok = await openNativeChat(selChat.id, selChat.title, selChat.team);
    if (!ok) console.info("better-teams: chat row not rendered in Teams sidebar:", selChat.title);
  }
  // Stable, so memoised Message rows skip re-rendering on composer keystrokes.
  const openInTeamsRef = useLatest(openInTeams);
  const onOpenInTeams = useCallback(() => void openInTeamsRef.current(), [openInTeamsRef]);

  const openProfile = useCallback((mri: string) => {
    if (mri) setProfileMri(mri);
  }, []);

  // Open a channel post's thread in the pane (a reply opens its root's).
  const showThread = useCallback((rootId: string) => {
    setProfileMri(null);
    setThreadRoot(rootId);
  }, []);
  const onThreadReply = useCallback((msg: Msg) => showThread(msg.rootId || msg.id), [showThread]);

  // Jump to a quoted message: scroll it into view and flash a highlight. If it's
  // not in the DOM (scrolled out / not paged in yet), page older until found.
  // `rootHint` (a notification's thread) opens a channel reply's thread even
  // when the reply isn't loaded.
  const onJumpTo = useCallback(
    (mid: string, rootHint?: string) => {
      const target = String(mid);
      const tryScroll = () => {
        // The thread pane first: a reply there is also its jump target.
        const q = `.tc-msg[data-mid="${CSS.escape(target)}"]`;
        const el = document.querySelector(`#tc-root .tc-thread-panel ${q}`) ?? scroller.current?.querySelector(q);
        if (!el) return false;
        // Else a late resize (paged-in content) re-pins the bottom mid-scroll.
        unstick();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("tc-flash");
        setTimeout(() => el.classList.remove("tc-flash"), 1400);
        return true;
      };
      // On screen, or a loaded channel reply: that lives in its thread, so
      // open the thread in the pane, then scroll there.
      const find = () => {
        if (tryScroll()) return true;
        const root = msgRoot.current.get(target) || rootHint;
        if (!root || root === target) return false;
        showThread(root);
        // The pane mounts on the next commit; a reply that is still syncing
        // in shows up a little later, so keep looking for a moment.
        let tries = 0;
        const settle = () => {
          if (!tryScroll() && ++tries < 30) requestAnimationFrame(settle);
        };
        requestAnimationFrame(settle);
        return true;
      };
      if (find()) return;
      // Not loaded: page older up to a few times, then scroll.
      const startSel = selRef.current;
      let misses = 0;
      const pump = async () => {
        // Stop on a chat switch, at history's end, or after a few loads that
        // brought nothing new (the message may simply not exist any more).
        if (selRef.current !== startSel || noMore.current || misses > 3) return;
        const added = await loadOlder();
        if (!added) misses++;
        requestAnimationFrame(() => {
          if (selRef.current === startSel && !find()) void pump();
        });
      };
      void pump();
    },
    [loadOlder, scroller, noMore, selRef, unstick, showThread],
  );

  // Seen while open: new items arriving with the feed on screen are read too.
  const { unread: feedUnread, markAllRead } = feed;
  useEffect(() => {
    if (activityShown && feedUnread) markAllRead();
  }, [activityShown, feedUnread, markAllRead]);

  // Bell: on opens the inbox (Activity tab when only the feed has news), off
  // goes back to all chats.
  const toggleInbox = () => {
    if (unreadOnly) return setUnreadFilter(false);
    setQuery("");
    setInboxTab(!unreadCount && feed.unread ? "activity" : "unread");
    setUnreadFilter(true);
  };

  const jumpToMessage = useCallback(
    (cid: string, mid: string | undefined, root?: string) => {
      pendingJump.current = mid ? { cid, mid, root } : null;
      setJumpSeq((n) => n + 1);
      pick(cid);
    },
    [pick],
  );
  const openActivityItem = useCallback(
    (item: Activity) => jumpToMessage(item.threadId, item.messageId, item.rootId || undefined),
    [jumpToMessage],
  );
  // Open a message by conversation + id (a forwarded message's original):
  // scroll to it here, or switch chats and jump once that chat has loaded.
  // Reads sel/chats through refs so the handler stays stable for memoized
  // messages across chat-list refreshes.
  const openMessage = useCallback(
    (cid: string, mid: string) => {
      if (cid === selRef.current) {
        if (mid) onJumpTo(mid);
        return;
      }
      if (!chatsRef.current.some((c) => c.id === cid)) {
        flash(t().app.originalMissing);
        return;
      }
      jumpToMessage(cid, mid);
    },
    [selRef, chatsRef, onJumpTo, jumpToMessage, flash],
  );
  // A Teams deep link inside a message: open it here when we have that chat,
  // else let the browser follow it.
  const openTeamsLink = useCallback(
    (link: TeamsLink) => {
      if (link.cid !== selRef.current && !chatsRef.current.some((c) => c.id === link.cid)) return false;
      openMessage(link.cid, link.mid);
      return true;
    },
    [selRef, chatsRef, openMessage],
  );
  useEffect(() => {
    const j = pendingJump.current;
    if (!j || !m.ready || sel !== j.cid) return;
    pendingJump.current = null;
    requestAnimationFrame(() => onJumpTo(j.mid, j.root));
  }, [jumpSeq, m.ready, sel, onJumpTo]);

  const openMenu = useCallback((e: MouseEvent, chat: Chat) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, chat });
  }, []);

  // Newest first: chats is already sorted.
  const sharedChats = useMemo(() => {
    if (!profileMri) return [];
    return chats.filter((c) => (c.members || []).includes(profileMri));
  }, [chats, profileMri]);

  // Day separators and grouping recompute over the filtered set so the result
  // reads naturally.
  const mq = msgSearchOpen ? msgSearch.toLowerCase().trim() : "";
  const visible = mq
    ? m.shown.filter(
        (x) => !x.deleted && (messageText(x).toLowerCase().includes(mq) || (x.from || "").toLowerCase().includes(mq)),
      )
    : m.shown;

  const nav = useMessageNav(content, cs.composer, selChat?.id ?? null);

  return (
    <>
      <Sidebar
        sections={sections}
        selfSlot={selfSlot}
        inboxTab={inboxTab}
        onInboxTab={setInboxTab}
        onBell={toggleInbox}
        activity={{ items: feed.items, unread: feed.unread, chats, onOpen: openActivityItem }}
        sel={sel}
        error={error}
        compact={compact}
        onCompact={(c) => setCompact(c)}
        onNewChat={() => a.setNewChat({ people: [], draft: false })}
        query={query}
        onQuery={setQuery}
        searchRef={search}
        onSearchEnter={(id) => {
          const target = id ?? flat[0]?.id;
          if (!target) return;
          pick(target);
          setQuery("");
          cs.composer.current?.focus();
        }}
        unreadOnly={unreadOnly}
        unreadCount={unreadCount}
        onUnreadFilter={setUnreadFilter}
        onPick={pick}
        onOpenProfile={openProfile}
        onMenu={openMenu}
        onAddChannel={(c) => void a.openNewChannel(c)}
        onTeamChannels={(e, c) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setTeamMenu((m) => (m && m.chat.teamId === c.teamId ? null : { rect, chat: c }));
        }}
        onHide={onHide}
        onError={(msg) => flash(msg, 4000)}
      />

      <main className="tc-main">
        <NetBanner />
        {selChat ? (
          <>
            <ChatHeader
              key={selChat.id}
              chat={selChat}
              onBack={() => setInChat(false)}
              searchOpen={msgSearchOpen}
              onToggleSearch={() => setMsgSearchOpen((o) => !o)}
              notesOpen={notesShown}
              onToggleNotes={toggleNotes}
              onOpenProfile={openProfile}
              onJoinCall={(rootId) => void a.joinCall(rootId)}
              onMeetNow={() => void a.meetNow()}
              onCall={(mris, kind, chat) => void a.startCall(mris, kind, chat)}
              flash={flash}
              knownPeople={a.knownPeople}
              onRename={a.rename}
              onSetMuted={a.setMuted}
              onSetFavorite={(chat, favorite) => void a.setFavorite(chat, favorite)}
              onAddMembers={a.addMembers}
              onRemoveMember={a.removeMember}
              onLeave={a.leave}
              onNewChannel={a.setNewChannel}
            />
            {msgSearchOpen ? (
              <MessageSearchBar
                query={msgSearch}
                onQuery={setMsgSearch}
                matches={visible.length}
                onClose={closeMsgSearch}
              />
            ) : null}
            <div className={"tc-msgs-wrap" + (m.atBottom ? "" : " scrolled-up")}>
              {m.stickyDay && !mq ? (
                <div className="tc-day-sticky">
                  <span>{m.stickyDay}</span>
                </div>
              ) : null}
              <div
                className="tc-msgs"
                ref={scroller}
                onScroll={m.onScroll}
                // At scrollTop 0 the wheel fires no scroll event: retry paging on it.
                onWheel={(e) => {
                  if (e.deltaY < 0 && e.currentTarget.scrollTop < 60) void loadOlder();
                }}
              >
                <div className="tc-msgs-inner" ref={content} tabIndex={-1}>
                  <Timeline
                    visible={visible}
                    cid={selChat.id}
                    chat={selChat}
                    channel={selIsChannel}
                    selectedId={nav.selected}
                    pending={m.myPending}
                    mq={mq}
                    searchText={msgSearch}
                    openThread={openThread}
                    onOpenThread={showThread}
                    msgRootRef={msgRoot}
                    loading={m.loading}
                    ready={m.ready}
                    failed={m.failed}
                    empty={!m.shown.length}
                    onRetry={m.refetch}
                    onOpenInTeams={onOpenInTeams}
                    onReact={m.react}
                    onDelete={m.remove}
                    onRemoveFile={m.removeFile}
                    onUndo={m.undo}
                    onEdit={m.edit}
                    onOpenProfile={openProfile}
                    onQuote={cs.onQuote}
                    onJumpTo={onJumpTo}
                    onOpenMessage={openMessage}
                    onOpenTeamsLink={openTeamsLink}
                    onThreadReply={onThreadReply}
                    onForward={onForward}
                    onJoinCall={(rootId) => void a.joinCall(rootId)}
                  />
                </div>
              </div>
            </div>
            {selChat.request ? (
              <div className="tc-composer tc-request">
                <span>{t().chat.requestBanner(selChat.title)}</span>
                <button className="tc-edit-btn" onClick={() => void a.answerRequest(selChat, "Block")}>
                  {t().chat.requestBlock}
                </button>
                <button className="tc-edit-btn primary" onClick={() => void a.answerRequest(selChat, "Accept")}>
                  {t().chat.requestAccept}
                </button>
              </div>
            ) : (
              <Composer
                chat={selChat}
                cs={cs}
                atBottom={m.atBottom}
                onScrollToBottom={m.scrollToBottom}
                onUpEmpty={nav.selectLast}
              />
            )}
          </>
        ) : (
          <>
            <div className="tc-drag tc-main-drag" />
            <div className="tc-empty">{error ? t().app.noTeamsData : t().app.selectChat}</div>
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

      {fwd ? <ForwardDialog msg={fwd.msg} chats={chats} onForward={doForward} onClose={() => setFwd(null)} /> : null}

      {a.newChannel ? (
        <NewChannel
          team={a.newChannel.team}
          known={a.knownPeople}
          onCreate={(name, desc, priv, threads, people) =>
            a.createChannel(a.newChannel!, name, desc, priv, threads, people)
          }
          onClose={() => a.setNewChannel(null)}
        />
      ) : null}

      {selChat && openThread ? (
        <ThreadPanel
          chat={selChat}
          rootId={openThread}
          messages={m.shown}
          pending={m.myPending}
          cs={ts}
          onClose={() => {
            setThreadRoot(null);
            cs.composer.current?.focus();
          }}
          onReact={m.react}
          onDelete={m.remove}
          onRemoveFile={m.removeFile}
          onUndo={m.undo}
          onEdit={m.edit}
          onOpenProfile={openProfile}
          onJumpTo={onJumpTo}
          onOpenMessage={openMessage}
          onOpenTeamsLink={openTeamsLink}
          onForward={onForward}
          onOpenInTeams={onOpenInTeams}
        />
      ) : null}

      {notesShown ? <NotesPanel onClose={() => setNotesOpen(false)} /> : null}

      {/* After the panes: a profile opens over the thread or notes pane and
          closing it shows that pane again. */}
      {profileMri ? (
        <ProfilePanel
          mri={profileMri}
          chats={sharedChats}
          sel={sel}
          onPick={(id) => {
            pick(id);
            setProfileMri(null);
          }}
          onBack={openThread || notesShown ? () => setProfileMri(null) : undefined}
          onClose={() => {
            setProfileMri(null);
            setThreadRoot(null);
            setNotesOpen(false);
          }}
          onMessage={() => {
            void a.startDirect(profileMri);
            setProfileMri(null);
          }}
          onCall={(kind) => {
            void a.startCall([profileMri], kind);
            setProfileMri(null);
          }}
        />
      ) : null}

      {teamMenu ? (
        <TeamChannelsMenu
          menu={teamMenu}
          chats={chats}
          onSetShown={a.setChannelShown}
          onClose={() => setTeamMenu(null)}
        />
      ) : null}
      {menu ? (
        <ChatMenu
          menu={menu}
          onClose={() => setMenu(null)}
          onSetUnread={(chat, unread) => void a.setChatUnread(chat, unread)}
          onSetHidden={(chat, hidden) => void a.setHidden(chat, hidden)}
          onSetFavorite={(chat, favorite) => void a.setFavorite(chat, favorite)}
          onSetMuted={a.setMuted}
          onLeave={a.leave}
          onNewChannel={a.setNewChannel}
          flash={flash}
        />
      ) : null}

      <FileViewer />

      {toast ? <div className="tc-toast">{toast}</div> : null}
    </>
  );
}
