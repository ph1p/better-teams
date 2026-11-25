import { t } from "../../i18n";
import { useState } from "react";
import { ArrowLeft, BellOff, Blocks, MessageSquareText, Phone, Search, StickyNote, Video, X } from "lucide-react";
import { profile, type PeopleHit } from "../../teamsData";
import { isAppMri } from "../../apps";
import { ChatIcon } from "../shared/Avatar";
import { chatTitle, isDirect } from "../lib/format";
import { statusLabel, usePresence } from "../lib/presence";
import { MAX_CALL } from "../lib/constants";
import type { Flash } from "../lib/toast";
import { ChatOptions } from "./ChatOptions";
import { MembersPanel } from "./MembersPanel";
import { ChannelMembersPanel } from "./ChannelMembersPanel";
import type { Chat } from "../../types";

interface ChatHeaderProps {
  chat: Chat;
  /** Back to the chat list (shown only on narrow windows). */
  onBack: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onOpenProfile: (mri: string) => void;
  onJoinCall: (rootId: string) => void;
  onMeetNow: () => void;
  onCall: (mris: string[], kind: "audio" | "video", chat: Chat) => void;
  flash: Flash;
  knownPeople: () => PeopleHit[];
  onRename: (chat: Chat, title: string) => Promise<boolean>;
  onSetMuted: (chat: Chat, muted: boolean) => void;
  onSetFavorite: (chat: Chat, favorite: boolean) => void;
  onAddMembers: (chat: Chat, people: PeopleHit[], shareHistoryDays: number) => Promise<boolean>;
  onRemoveMember: (chat: Chat, mri: string) => Promise<boolean>;
  onLeave: (chat: Chat, what?: "channel" | "team" | "delete") => void;
  onNewChannel: (chat: Chat) => void;
}

function RenameInput({
  chat,
  onRename,
  onDone,
}: {
  chat: Chat;
  onRename: (chat: Chat, title: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const [v, setV] = useState(chat.title);
  const save = async () => {
    if (await onRename(chat, v)) onDone();
  };
  return (
    <input
      className="tc-head-rename"
      autoFocus
      value={v}
      maxLength={256}
      aria-label={t().chat.name}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setV(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    />
  );
}

export function ChatHeader({
  chat,
  onBack,
  searchOpen,
  onToggleSearch,
  notesOpen,
  onToggleNotes,
  onOpenProfile,
  onJoinCall,
  onMeetNow,
  onCall,
  flash,
  knownPeople,
  onRename,
  onSetMuted,
  onSetFavorite,
  onAddMembers,
  onRemoveMember,
  onLeave,
  onNewChannel,
}: ChatHeaderProps) {
  const { statusOf, noteOf } = usePresence();
  const note = isDirect(chat) && chat.avatarMri ? noteOf(chat.avatarMri) : "";
  const [renaming, setRenaming] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  // Calls: 1:1 and group chats ring their members (Teams rings at most 20 in a
  // group call). Channels, meetings and Notes have no callee list here. Apps
  // (bots) can't be called, so they never count as callees.
  const callees = chat.kind === "chat" ? chat.members.filter((m) => !isAppMri(m)) : [];
  const callable = callees.length > 0 && callees.length <= MAX_CALL;
  const audioLabel = callees.length <= 1 ? t().common.audioCall : t().chat.groupAudioCall(callees.length);
  const videoLabel = callees.length <= 1 ? t().common.videoCall : t().chat.groupVideoCall(callees.length);
  const headSub = chat.isChannel
    ? chat.team
    : chat.kind === "meeting"
      ? t().chat.meetingChat
      : chat.kind === "notes"
        ? t().chat.onlyYou
        : chat.app
          ? [t().chat.teamsApp, profile(chat.avatarMri).developer].filter(Boolean).join(" · ")
          : chat.group
            ? t().chat.people(chat.members.length + 1)
            : chat.avatarMri
              ? [
                  statusOf(chat.avatarMri) === "Unknown" ? "" : statusLabel(statusOf(chat.avatarMri)),
                  profile(chat.avatarMri).jobTitle,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : chat.team;
  return (
    <>
      <div className="tc-main-head">
        <button
          className="tc-ghost tc-icon-only tc-head-back"
          onClick={onBack}
          title={t().common.back}
          aria-label={t().common.back}
        >
          <ArrowLeft size={18} />
        </button>
        <ChatIcon chat={chat} size={18} onOpen={onOpenProfile} />
        <div className="tc-head-text">
          <span className="tc-head-title">
            {renaming ? (
              <RenameInput chat={chat} onRename={onRename} onDone={() => setRenaming(false)} />
            ) : (
              <span className="tc-name" onDoubleClick={chat.group && !chat.left ? () => setRenaming(true) : undefined}>
                {chatTitle(chat)}
              </span>
            )}
            {chat.muted ? <BellOff size={13} className="tc-head-muted" aria-label={t().common.muted} /> : null}
            {chat.app ? <span className="tc-app-badge">{t().common.app}</span> : null}
          </span>
          {headSub ? (
            <span className="tc-sub" title={headSub}>
              {headSub}
            </span>
          ) : null}
        </div>
        <button
          className={"tc-ghost tc-icon-only" + (searchOpen ? " on" : "")}
          onClick={onToggleSearch}
          title={t().chat.search}
          aria-label={t().chat.search}
        >
          <Search size={15} />
        </button>
        <button
          className={"tc-ghost tc-icon-only" + (notesOpen ? " on" : "")}
          onClick={onToggleNotes}
          title={t().chat.notesKey}
          aria-label={t().common.notes}
          aria-pressed={notesOpen}
        >
          <StickyNote size={15} />
        </button>
        {chat.liveCall ? (
          <button className="tc-join" onClick={() => onJoinCall(chat.liveCall!)} title={t().chat.joinRunning}>
            <Video size={14} /> {t().chat.join}
          </button>
        ) : chat.isChannel ? (
          <button
            className="tc-ghost tc-icon-only"
            onClick={onMeetNow}
            title={t().chat.meetNow}
            aria-label={t().chat.meetNow}
          >
            <Video size={15} />
          </button>
        ) : null}
        {callable ? (
          <>
            <button
              className="tc-ghost tc-icon-only"
              onClick={() => onCall(callees, "audio", chat)}
              title={audioLabel}
              aria-label={audioLabel}
            >
              <Phone size={15} />
            </button>
            <button
              className="tc-ghost tc-icon-only"
              onClick={() => onCall(callees, "video", chat)}
              title={videoLabel}
              aria-label={videoLabel}
            >
              <Video size={15} />
            </button>
          </>
        ) : null}
        <ChatOptions
          chat={chat}
          flash={flash}
          onRename={() => setRenaming(true)}
          onMembers={() => setMembersOpen(true)}
          onSetMuted={onSetMuted}
          onSetFavorite={onSetFavorite}
          onLeave={onLeave}
          onNewChannel={onNewChannel}
        />
      </div>
      {membersOpen && chat.group && !chat.left ? (
        <MembersPanel
          chat={chat}
          known={knownPeople}
          onClose={() => setMembersOpen(false)}
          onOpenProfile={onOpenProfile}
          onAdd={onAddMembers}
          onRemove={onRemoveMember}
        />
      ) : membersOpen && chat.isChannel && !chat.left ? (
        <ChannelMembersPanel
          chat={chat}
          known={knownPeople}
          flash={flash}
          onClose={() => setMembersOpen(false)}
          onOpenProfile={onOpenProfile}
        />
      ) : null}
      {chat.app ? (
        <div className="tc-app-note">
          <Blocks size={14} />
          <span>
            <b>{t().chat.appNoteTitle}</b> {t().chat.appNote(chat.title, profile(chat.avatarMri).developer || "")}
          </span>
        </div>
      ) : null}
      {note ? (
        <div className="tc-app-note tc-status-note">
          <MessageSquareText size={14} />
          <span>
            <b>{t().chat.statusNoteOf(chatTitle(chat))}</b> {note}
          </span>
        </div>
      ) : null}
    </>
  );
}

interface MessageSearchBarProps {
  query: string;
  onQuery: (q: string) => void;
  matches: number;
  onClose: () => void;
}

export function MessageSearchBar({ query, onQuery, matches, onClose }: MessageSearchBarProps) {
  return (
    <div className="tc-msgsearch">
      <Search size={14} className="tc-search-icon" />
      <input
        autoFocus
        placeholder={t().chat.search}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      />
      {query ? <span className="tc-msgsearch-n">{t().chat.matches(matches)}</span> : null}
      <button className="tc-msgsearch-x" onClick={onClose} aria-label={t().chat.closeSearch}>
        <X size={14} />
      </button>
    </div>
  );
}
