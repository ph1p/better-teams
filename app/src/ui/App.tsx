import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from "react";
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
import { ForwardDialog } from "./chat/ForwardDialog";
import { ProfilePanel } from "./profile/ProfilePanel";
import { NotesPanel } from "./notes/NotesPanel";
import { FileViewer } from "./shared/FileViewer";
import { chatTitle, messageText } from "./lib/format";
import { usePref } from "./lib/prefs";
import { useToast } from "./lib/toast";
import type { Activity, Chat, Message as Msg } from "../types";
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

export default function App({ onHide }: { onHide?: () => void }): JSX.Element {
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
  // Sidebar density: compact one-line rows (default) or name + preview.
  const [compact, setCompact] = usePref<boolean>("compact", true);
  const [keep, setKeep] = useState<Set<string>>(() => new Set());
  const [profileMri, setProfileMri] = useState<string | null>(null);
  // Notes drawer (local scratchpad). Open on first run, then
  // remembers whether it was left open or closed.
  const [notesOpen, setNotesOpen] = usePref<boolean>("notesOpen", true);
  // Right-click chat menu: {x, y, chat} or null.
  const [menu, setMenu] = useState<Menu | null>(null);
  // A team label's show/hide channel list, under its button.
  const [teamMenu, setTeamMenu] = useState<TeamMenu | null>(null);
  // In-conversation message search: open flag + query string.
  const [msgSearch, setMsgSearch] = useState("");
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  // Channel threads whose older replies are expanded (by root id).
  const [openThreads, setOpenThreads] = useState<ReadonlySet<string>>(new Set());
  // message id -> thread root id for the rendered channel, so jump-to can
  // expand a collapsed thread before scrolling.
  const msgRoot = useRef<Map<string, string>>(new Map());
  const search = useRef<HTMLInputElement>(null);
  // Forward dialog: the message and the conversation it came from.
  const [fwd, setFwd] = useState<{ msg: Msg; from: string } | null>(null);

  const selChat = chats.find((c) => c.id === sel);
  const selIsChannel = !!selChat?.isChannel;
  const selRef = useLatest(sel);
  const messages = useMessages(sel, selChat, flash);
  const cs = useComposerState(sel, selChat, messages, flash);
  // Refs pulled out, so reading the rest during render is plainly not a ref read.
  const { scroller, content, noMore, loadOlder, unstick, ...m } = messages;

  // A new conversation starts with search closed and threads collapsed.
  const switched = useChanged(sel + "|" + selIsChannel);
  if (switched && sel) {
    setMsgSearch("");
    setMsgSearchOpen(false);
    setOpenThreads(new Set());
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
  const pendingJump = useRef<{ cid: string; mid: string } | null>(null);
  // Bumped per item click so the jump effect re-runs even when the chat is already open.
  const [jumpSeq, setJumpSeq] = useState(0);

  const pick = useCallback(
    (id: string): void => {
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
    (on: boolean): void => {
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

  const closeMsgSearch = (): void => {
    setMsgSearch("");
    setMsgSearchOpen(false);
  };
  const toggleNotes = (): void => {
    setProfileMri(null);
    setNotesOpen((o) => !o);
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
    async (target: Chat, comment: string): Promise<string | null> => {
      if (!fwd) return null;
      const r = await forwardMessage(target.id, fwd.from, fwd.msg.id, comment);
      if (!r.ok) return t().app.forwardFailed(r.reason);
      setFwd(null);
      flash(t().app.forwarded(chatTitle(target)));
      return null;
    },
    [fwd, flash],
  );

  async function openInTeams(): Promise<void> {
    if (!selChat) return;
    onHide?.();
    const ok = await openNativeChat(selChat.id, selChat.title, selChat.team);
    if (!ok) console.info("better-teams: chat row not rendered in Teams sidebar:", selChat.title);
  }

  const openProfile = useCallback((mri: string): void => {
    if (mri) setProfileMri(mri);
  }, []);

  const toggleThread = useCallback((rootId: string): void => {
    setOpenThreads((s) => {
      const n = new Set(s);
      if (n.has(rootId)) n.delete(rootId);
      else n.add(rootId);
      return n;
    });
  }, []);

  // Jump to a quoted message: scroll it into view and flash a highlight. If it's
  // not in the DOM (scrolled out / not paged in yet), page older until found.
  const onJumpTo = useCallback(
    (mid: string): void => {
      const target = String(mid);
      const tryScroll = (): boolean => {
        const el = scroller.current?.querySelector(`.tc-msg[data-mid="${CSS.escape(target)}"]`);
        if (!el) return false;
        // Else a late resize (paged-in content) re-pins the bottom mid-scroll.
        unstick();
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
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            tryScroll();
          }),
        );
        return;
      }
      // Not loaded: page older up to a few times, then scroll.
      const startSel = selRef.current;
      let misses = 0;
      const pump = async (): Promise<void> => {
        // Stop on a chat switch, at history's end, or after a few loads that
        // brought nothing new (the message may simply not exist any more).
        if (selRef.current !== startSel || noMore.current || misses > 3) return;
        const added = await loadOlder();
        if (!added) misses++;
        requestAnimationFrame(() => {
          if (selRef.current === startSel && !tryScroll()) void pump();
        });
      };
      void pump();
    },
    [loadOlder, scroller, noMore, selRef, unstick],
  );

  // Seen while open: new items arriving with the feed on screen are read too.
  const { unread: feedUnread, markAllRead } = feed;
  useEffect(() => {
    if (activityShown && feedUnread) markAllRead();
  }, [activityShown, feedUnread, markAllRead]);

  // Bell: on opens the inbox (Activity tab when only the feed has news), off
  // goes back to all chats.
  const toggleInbox = (): void => {
    if (unreadOnly) return setUnreadFilter(false);
    setQuery("");
    setInboxTab(!unreadCount && feed.unread ? "activity" : "unread");
    setUnreadFilter(true);
  };

  // Switch to a chat and jump to `mid` (if any) once it has loaded.
  const jumpToMessage = useCallback(
    (cid: string, mid: string | undefined): void => {
      pendingJump.current = mid ? { cid, mid } : null;
      setJumpSeq((n) => n + 1);
      pick(cid);
    },
    [pick],
  );
  const openActivityItem = useCallback(
    (item: Activity): void => jumpToMessage(item.threadId, item.messageId),
    [jumpToMessage],
  );
  // Open a message by conversation + id (a forwarded message's original):
  // scroll to it here, or switch chats and jump once that chat has loaded.
  // Reads sel/chats through refs so the handler stays stable for memoized
  // messages across chat-list refreshes.
  const openMessage = useCallback(
    (cid: string, mid: string): void => {
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
  useEffect(() => {
    const j = pendingJump.current;
    if (!j || !m.ready || sel !== j.cid) return;
    pendingJump.current = null;
    requestAnimationFrame(() => onJumpTo(j.mid));
  }, [jumpSeq, m.ready, sel, onJumpTo]);

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
        onSearchEnter={() => {
          if (!flat[0]) return;
          pick(flat[0].id);
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
        {selChat ? (
          <>
            <ChatHeader
              key={selChat.id}
              chat={selChat}
              searchOpen={msgSearchOpen}
              onToggleSearch={() => setMsgSearchOpen((o) => !o)}
              notesOpen={notesOpen}
              onToggleNotes={toggleNotes}
              onOpenProfile={openProfile}
              onJoinCall={(rootId) => void a.joinCall(rootId)}
              onMeetNow={() => void a.meetNow()}
              onCall={(mris, kind, chat) => void a.startCall(mris, kind, chat)}
              flash={flash}
              knownPeople={a.knownPeople}
              onRename={a.rename}
              onSetMuted={a.setMuted}
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
            <div className="tc-msgs-wrap">
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
                    openThreads={openThreads}
                    onToggleThread={toggleThread}
                    replyingTo={cs.threadTo?.rootId}
                    msgRootRef={msgRoot}
                    loading={m.loading}
                    ready={m.ready}
                    failed={m.failed}
                    empty={!m.shown.length}
                    onRetry={m.refetch}
                    onOpenInTeams={() => void openInTeams()}
                    onReact={m.react}
                    onDelete={m.remove}
                    onRemoveFile={m.removeFile}
                    onUndo={m.undo}
                    onEdit={m.edit}
                    onOpenProfile={openProfile}
                    onQuote={cs.onQuote}
                    onJumpTo={onJumpTo}
                    onOpenMessage={openMessage}
                    onThreadReply={cs.onThreadReply}
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

      {profileMri ? (
        <ProfilePanel
          mri={profileMri}
          chats={sharedChats}
          sel={sel}
          onPick={(id) => {
            pick(id);
            setProfileMri(null);
          }}
          onClose={() => setProfileMri(null)}
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

      {notesOpen && !profileMri ? <NotesPanel onClose={() => setNotesOpen(false)} /> : null}

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
