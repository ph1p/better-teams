import type { JSX } from "react";
import { Bell, BellOff, Eye, EyeOff, Mail, MailOpen, Star, StarOff } from "lucide-react";
import { menuPos } from "../lib/menuPos";
import { useDismiss } from "../lib/dismiss";
import type { Chat } from "../../types";
import type { Flash } from "../lib/toast";
import { t } from "../../i18n";
import { ChannelLeaveItem, ChannelPresets } from "../chat/ChannelItems";
import { MenuItem } from "../shared/MenuItem";

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
}: ChatMenuProps) {
  useDismiss(true, "#tc-root .tc-menu", onClose);
  const s = t().sidebar;
  const c = menu.chat;
  const item = (icon: JSX.Element, label: string, fn: () => void) => (
    <MenuItem icon={icon} close={onClose} onPick={fn}>
      {label}
    </MenuItem>
  );
  // Channels: Teams' unread bookmark op is only known for chats.
  const unread = !c.isChannel || c.unread;
  // Notes always sits in the sidebar footer: nothing to favorite, mute or hide.
  const notes = c.kind === "notes";
  // The channel menu is tall and grows as Teams answers: in the lower half,
  // anchor it by its bottom edge so it opens upwards and stays on screen.
  return (
    <div
      className="tc-menu"
      role="menu"
      style={menuPos(menu.x, menu.y, menu.y, 220)}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {unread
        ? item(c.unread ? <MailOpen size={14} /> : <Mail size={14} />, c.unread ? s.markRead : s.markUnread, () =>
            onSetUnread(c, !c.unread),
          )
        : null}
      {/* Channels go into the same Favorites folder as chats. */}
      {notes
        ? null
        : item(
            c.favorite ? <StarOff size={14} /> : <Star size={14} />,
            c.favorite ? s.removeFavorite : s.addFavorite,
            () => onSetFavorite(c, !c.favorite),
          )}
      {c.isChannel ? (
        <>
          <div className="tc-menu-sep" />
          <ChannelPresets chat={c} flash={flash} onDone={onClose} />
          <ChannelLeaveItem chat={c} onLeave={onLeave} onNewChannel={onNewChannel} onDone={onClose} />
        </>
      ) : notes ? null : (
        <>
          <div className="tc-menu-sep" />
          {item(
            c.muted ? <Bell size={14} /> : <BellOff size={14} />,
            c.muted ? t().common.unmute : t().common.mute,
            () => onSetMuted(c, !c.muted),
          )}
          {item(c.hidden ? <Eye size={14} /> : <EyeOff size={14} />, c.hidden ? s.unhide : s.hide, () =>
            onSetHidden(c, !c.hidden),
          )}
        </>
      )}
    </div>
  );
}
