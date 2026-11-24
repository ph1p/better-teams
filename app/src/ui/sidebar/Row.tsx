import type { JSX, MouseEvent } from "react";
import { BellOff, Video } from "lucide-react";
import { ChatIcon } from "../shared/Avatar";
import { chatTitle, fmtTime, oneLine } from "../lib/format";
import { usePresence } from "../lib/presence";
import type { Chat } from "../../types";
import { t } from "../../i18n";
import { cardSummary, parseCards } from "../../cards";

interface RowProps {
  chat: Chat;
  selected: boolean;
  // Single line (name only) instead of name + last-message preview.
  compact: boolean;
  // Prefix channel previews with the team (off when the section groups by team).
  showTeam?: boolean;
  onClick: () => void;
  onOpenProfile: (mri: string) => void;
  onMenu?: (e: MouseEvent, chat: Chat) => void;
}

const preview = (chat: Chat): string => {
  const text = /Media_Card/i.test(chat.last.type)
    ? cardSummary(parseCards(chat.last.content)) || t().sidebar.card
    : oneLine(chat.last.content);
  return (chat.last.from ? chat.last.from + ": " : "") + (text.slice(0, 120) || "…");
};

// One conversation row in the sidebar. Compact: icon/avatar + name, the time
// only on hover, the last message as a tooltip. Detailed: adds a preview line.
export function Row({
  chat,
  selected,
  compact,
  showTeam = true,
  onClick,
  onOpenProfile,
  onMenu,
}: RowProps): JSX.Element {
  // Subscribed so the avatar's presence ring stays live.
  usePresence();
  const prev = preview(chat);
  const icon = <ChatIcon chat={chat} small={compact} size={compact ? 13 : 16} onOpen={onOpenProfile} />;
  return (
    <div
      className={
        "tc-row" +
        (compact ? " compact" : "") +
        (selected ? " sel" : "") +
        (chat.unread ? " unread" : "") +
        (chat.channelHidden ? " ghost" : "")
      }
      onClick={onClick}
      onContextMenu={onMenu ? (e) => onMenu(e, chat) : undefined}
      title={compact ? chatTitle(chat) + "\n" + prev : undefined}
      data-id={chat.id}
    >
      {icon}
      <div className="tc-row-body">
        <div className="tc-row-top">
          <span className="tc-row-title">
            <span className="tc-name">{chatTitle(chat)}</span>
            {chat.muted ? <BellOff size={12} className="tc-row-muted" aria-label={t().common.muted} /> : null}
            {chat.app ? <span className="tc-app-badge">{t().common.app}</span> : null}
          </span>
          <span className="tc-time">{fmtTime(chat.time)}</span>
        </div>
        {compact ? null : (
          <div className="tc-prev">
            {showTeam && chat.isChannel && chat.team ? <span className="tc-team">{chat.team} · </span> : null}
            {prev}
          </div>
        )}
      </div>
      {chat.liveCall ? (
        <span className="tc-row-live" title={t().sidebar.liveCall} aria-label={t().sidebar.liveCall}>
          <span className="tc-live-dot" />
          {compact ? null : <Video size={12} />}
        </span>
      ) : null}
      {chat.unread ? <span className="tc-unread" aria-label={t().sidebar.unreadDot} /> : null}
    </div>
  );
}
