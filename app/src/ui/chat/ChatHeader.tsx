import type { JSX } from "react";
import { Blocks, Hash, Phone, Search, StickyNote, Video, X } from "lucide-react";
import { profile } from "../../teamsData";
import { isAppMri } from "../../apps";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { STATUS_LABEL, usePresence } from "../lib/presence";
import { MAX_CALL } from "../lib/constants";
import type { Chat } from "../../types";

interface ChatHeaderProps {
  chat: Chat;
  searchOpen: boolean;
  onToggleSearch: () => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onOpenProfile: (mri: string) => void;
  onJoinCall: (rootId: string) => void;
  onMeetNow: () => void;
  onCall: (mris: string[], kind: "audio" | "video", chat: Chat) => void;
}

// Header of the open conversation: avatar, title + subtitle, search / notes
// toggles and the call buttons; app chats get an explanatory strip below.
export function ChatHeader({ chat, searchOpen, onToggleSearch, notesOpen, onToggleNotes, onOpenProfile, onJoinCall, onMeetNow, onCall }: ChatHeaderProps): JSX.Element {
  const { statusOf } = usePresence();
  // Calls: 1:1 and group chats ring their members (Teams rings at most 20 in a
  // group call). Channels, meetings and Notes have no callee list here. Apps
  // (bots) can't be called, so they never count as callees.
  const callees = chat.kind === "chat" ? chat.members.filter((m) => !isAppMri(m)) : [];
  const callable = callees.length > 0 && callees.length <= MAX_CALL;
  const callLabel = (what: string): string =>
    callees.length <= 1 ? what : `Group ${what.toLowerCase()} (${callees.length} people)`;
  // Header subtitle: what is useful to know about the other side right now.
  const headSub =
    chat.isChannel ? chat.team :
    chat.kind === "meeting" ? "Meeting chat" :
    chat.kind === "notes" ? "Only you" :
    chat.app ? ["Teams app", profile(chat.avatarMri).developer].filter(Boolean).join(" · ") :
    chat.members.length > 1 ? `${chat.members.length + 1} people` :
    chat.avatarMri ? [statusOf(chat.avatarMri) === "Unknown" ? "" : STATUS_LABEL[statusOf(chat.avatarMri)], profile(chat.avatarMri).jobTitle].filter(Boolean).join(" · ") :
    chat.team;
  return (
    <>
      <div className="tc-main-head">
        {chat.isChannel ? (
          <div className="tc-av tc-hash"><Hash size={18} /></div>
        ) : (
          <Avatar name={chat.title} uri={avatarUri(chat.avatarMri)} mri={chat.avatarMri} status={statusOf(chat.avatarMri)} onOpen={onOpenProfile} />
        )}
        <div className="tc-head-text">
          <span className="tc-head-title">
            <span className="tc-name">{chat.title}</span>
            {chat.app ? <span className="tc-app-badge">App</span> : null}
          </span>
          {headSub ? <span className="tc-sub">{headSub}</span> : null}
        </div>
        <button
          className={"tc-ghost tc-icon-only" + (searchOpen ? " on" : "")}
          onClick={onToggleSearch}
          title="Search in this chat"
          aria-label="Search in this chat"
        >
          <Search size={15} />
        </button>
        <button
          className={"tc-ghost tc-icon-only" + (notesOpen ? " on" : "")}
          onClick={onToggleNotes}
          title="Notes (⌥N)"
          aria-label="Notes"
          aria-pressed={notesOpen}
        >
          <StickyNote size={15} />
        </button>
        {chat.liveCall ? (
          <button className="tc-join" onClick={() => onJoinCall(chat.liveCall!)} title="Join the running call">
            <Video size={14} /> Join
          </button>
        ) : chat.isChannel ? (
          <button className="tc-ghost tc-icon-only" onClick={onMeetNow} title="Meet now in this channel" aria-label="Meet now in this channel">
            <Video size={15} />
          </button>
        ) : null}
        {callable ? (
          <>
            <button className="tc-ghost tc-icon-only" onClick={() => onCall(callees, "audio", chat)} title={callLabel("Audio call")} aria-label={callLabel("Audio call")}>
              <Phone size={15} />
            </button>
            <button className="tc-ghost tc-icon-only" onClick={() => onCall(callees, "video", chat)} title={callLabel("Video call")} aria-label={callLabel("Video call")}>
              <Video size={15} />
            </button>
          </>
        ) : null}
      </div>
      {chat.app ? (
        <div className="tc-app-note">
          <Blocks size={14} />
          <span>
            <b>App chat.</b> {chat.title} is a Teams app
            {profile(chat.avatarMri).developer ? ` by ${profile(chat.avatarMri).developer}` : ""}, not a person.
            It posts updates and answers commands; it can't be called.
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

// In-conversation search box (⌘F), shown under the header while open.
export function MessageSearchBar({ query, onQuery, matches, onClose }: MessageSearchBarProps): JSX.Element {
  return (
    <div className="tc-msgsearch">
      <Search size={14} className="tc-search-icon" />
      <input
        autoFocus
        placeholder="Search in this chat"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      />
      {query ? (
        <span className="tc-msgsearch-n">{matches} match{matches === 1 ? "" : "es"}</span>
      ) : null}
      <button className="tc-msgsearch-x" onClick={onClose} aria-label="Close search"><X size={14} /></button>
    </div>
  );
}
