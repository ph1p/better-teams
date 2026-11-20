import type { JSX } from "react";
import { Bell, BellOff, Eye, EyeOff, Mail, MailOpen } from "lucide-react";
import { useDismiss } from "../lib/dismiss";
import type { Chat } from "../../types";
import { t } from "../../i18n";

// Right-click chat menu position + target.
export interface Menu { x: number; y: number; chat: Chat; }

interface ChatMenuProps {
  menu: Menu;
  onClose: () => void;
  onSetUnread: (chat: Chat, unread: boolean) => void;
  onSetHidden: (chat: Chat, hidden: boolean) => void;
  onSetMuted: (chat: Chat, muted: boolean) => void;
}

// The right-click menu for a chat row: read state, mute and hide/unhide.
// Channels mute through the header's notification presets instead.
export function ChatMenu({ menu, onClose, onSetUnread, onSetHidden, onSetMuted }: ChatMenuProps): JSX.Element {
  // Close the menu on any click, scroll, Escape, or resize.
  useDismiss(true, "#tc-root .tc-menu", onClose);
  const s = t().sidebar;
  return (
    <div
      className="tc-menu"
      style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 170) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Channels: Teams' unread bookmark op is only known for chats. */}
      {menu.chat.isChannel && !menu.chat.unread ? null : (
        <button
          className="tc-menu-item"
          onClick={() => { onSetUnread(menu.chat, !menu.chat.unread); onClose(); }}
        >
          {menu.chat.unread ? <MailOpen size={14} /> : <Mail size={14} />}
          {menu.chat.unread ? s.markRead : s.markUnread}
        </button>
      )}
      {menu.chat.isChannel || menu.chat.kind === "notes" ? null : (
        <button
          className="tc-menu-item"
          onClick={() => { onSetMuted(menu.chat, !menu.chat.muted); onClose(); }}
        >
          {menu.chat.muted ? <Bell size={14} /> : <BellOff size={14} />}
          {menu.chat.muted ? t().common.unmute : t().common.mute}
        </button>
      )}
      {menu.chat.isChannel ? null : (
        <button
          className="tc-menu-item"
          onClick={() => { onSetHidden(menu.chat, !menu.chat.hidden); onClose(); }}
        >
          {menu.chat.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
          {menu.chat.hidden ? s.unhide : s.hide}
        </button>
      )}
    </div>
  );
}
