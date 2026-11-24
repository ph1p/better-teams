import type { JSX } from "react";
import { Bell, BellOff, Eye, EyeOff, Mail, MailOpen, Star, StarOff } from "lucide-react";
import { menuPos } from "../lib/menuPos";
import { useDismiss } from "../lib/dismiss";
import type { Chat } from "../../types";
import type { Flash } from "../lib/toast";
import { t } from "../../i18n";
import { ChannelLeaveItem, ChannelPresets } from "../chat/ChannelItems";

// Right-click chat menu position + target.
export interface Menu {
  x: number;
  y: number;
  chat: Chat;
}

interface ChatMenuProps {
  menu: Menu;
  onClose: () => void;
  onSetUnread: (chat: Chat, unread: boolean) => void;
  onSetHidden: (chat: Chat, hidden: boolean) => void;
  onSetFavorite: (chat: Chat, favorite: boolean) => void;
  onSetMuted: (chat: Chat, muted: boolean) => void;
  onLeave: (chat: Chat, what?: "channel" | "team" | "delete") => void;
  onNewChannel: (chat: Chat) => void;
  flash: Flash;
}

// The right-click menu for a chat row: read state, mute and hide/unhide.
// Channels get their notification presets (whose "Off" mutes) and leave.
export function ChatMenu({
  menu,
  onClose,
  onSetUnread,
  onSetHidden,
  onSetFavorite,
  onSetMuted,
  onLeave,
  onNewChannel,
  flash,
}: ChatMenuProps): JSX.Element {
  // Close the menu on any click, scroll, Escape, or resize.
  useDismiss(true, "#tc-root .tc-menu", onClose);
  const s = t().sidebar;
  // The channel menu is tall and grows as Teams answers: in the lower half,
  // anchor it by its bottom edge so it opens upwards and stays on screen.
  return (
    <div className="tc-menu" style={menuPos(menu.x, menu.y, menu.y, 220)} onMouseDown={(e) => e.stopPropagation()}>
      {/* Channels: Teams' unread bookmark op is only known for chats. */}
      {menu.chat.isChannel && !menu.chat.unread ? null : (
        <button
          className="tc-menu-item"
          onClick={() => {
            onSetUnread(menu.chat, !menu.chat.unread);
            onClose();
          }}
        >
          {menu.chat.unread ? <MailOpen size={14} /> : <Mail size={14} />}
          {menu.chat.unread ? s.markRead : s.markUnread}
        </button>
      )}
      {/* Channels go into the same Favorites folder as chats;
          Notes always sits in the sidebar footer. */}
      {menu.chat.kind === "notes" ? null : (
        <button
          className="tc-menu-item"
          onClick={() => {
            onSetFavorite(menu.chat, !menu.chat.favorite);
            onClose();
          }}
        >
          {menu.chat.favorite ? <StarOff size={14} /> : <Star size={14} />}
          {menu.chat.favorite ? s.removeFavorite : s.addFavorite}
        </button>
      )}
      {menu.chat.isChannel || menu.chat.kind === "notes" ? null : (
        <button
          className="tc-menu-item"
          onClick={() => {
            onSetMuted(menu.chat, !menu.chat.muted);
            onClose();
          }}
        >
          {menu.chat.muted ? <Bell size={14} /> : <BellOff size={14} />}
          {menu.chat.muted ? t().common.unmute : t().common.mute}
        </button>
      )}
      {menu.chat.isChannel ? null : (
        <button
          className="tc-menu-item"
          onClick={() => {
            onSetHidden(menu.chat, !menu.chat.hidden);
            onClose();
          }}
        >
          {menu.chat.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
          {menu.chat.hidden ? s.unhide : s.hide}
        </button>
      )}
      {menu.chat.isChannel ? (
        <>
          {menu.chat.unread ? <div className="tc-menu-sep" /> : null}
          <ChannelPresets chat={menu.chat} flash={flash} onDone={onClose} />
          <ChannelLeaveItem chat={menu.chat} onLeave={onLeave} onNewChannel={onNewChannel} onDone={onClose} />
        </>
      ) : null}
    </div>
  );
}
