import type { JSX, MouseEvent } from "react";
import { Hash } from "lucide-react";
import { Avatar } from "../shared/Avatar";
import { avatarUri, fmtTime, oneLine } from "../lib/format";
import { usePresence } from "../lib/presence";
import type { Chat } from "../../types";

interface RowProps {
  chat: Chat;
  selected: boolean;
  onClick: () => void;
  onOpenProfile: (mri: string) => void;
  onMenu?: (e: MouseEvent, chat: Chat) => void;
}

// One conversation row in the sidebar: avatar/hash, title, time, and a one-line
// preview of the last message (sender prefix for groups/channels).
export function Row({ chat, selected, onClick, onOpenProfile, onMenu }: RowProps): JSX.Element {
  const { statusOf } = usePresence();
  const preview = /Media_Card/i.test(chat.last.type) ? "[Card]" : oneLine(chat.last.content);
  return (
    <div
      className={"tc-row" + (selected ? " sel" : "") + (chat.unread ? " unread" : "")}
      onClick={onClick}
      onContextMenu={onMenu ? (e) => onMenu(e, chat) : undefined}
      data-id={chat.id}
    >
      {chat.isChannel ? (
        <div className="tc-av tc-hash"><Hash size={16} /></div>
      ) : (
        <Avatar name={chat.title} uri={avatarUri(chat.avatarMri)} mri={chat.avatarMri} status={statusOf(chat.avatarMri)} onOpen={onOpenProfile} />
      )}
      <div className="tc-row-body">
        <div className="tc-row-top">
          <span className="tc-name">{chat.title}</span>
          <span className="tc-time">{fmtTime(chat.time)}</span>
        </div>
        <div className="tc-prev">
          {chat.isChannel && chat.team ? <span className="tc-team">{chat.team} · </span> : null}
          {chat.last.from ? chat.last.from + ": " : ""}
          {preview.slice(0, 80) || "…"}
        </div>
      </div>
      {chat.unread ? <span className="tc-unread" /> : null}
    </div>
  );
}
