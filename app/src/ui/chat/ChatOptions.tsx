import { t } from "../../i18n";
import { useState } from "react";
import { Bell, BellOff, LogOut, MoreHorizontal, Pencil, Star, StarOff, Users } from "lucide-react";
import { ChannelLeaveItem, ChannelPresets } from "./ChannelItems";
import { useDismiss } from "../lib/dismiss";
import { menuPos } from "../lib/menuPos";
import { MenuItem } from "../shared/MenuItem";
import { useArm } from "../lib/arm";
import type { Flash } from "../lib/toast";
import type { Chat } from "../../types";

interface ChatOptionsProps {
  chat: Chat;
  flash: Flash;
  onRename: () => void;
  onMembers: () => void;
  onSetMuted: (chat: Chat, muted: boolean) => void;
  onSetFavorite: (chat: Chat, favorite: boolean) => void;
  onLeave: (chat: Chat, what?: "channel" | "team" | "delete") => void;
  onNewChannel: (chat: Chat) => void;
}

export function ChatOptions({
  chat,
  flash,
  onRename,
  onMembers,
  onSetMuted,
  onSetFavorite,
  onLeave,
  onNewChannel,
}: ChatOptionsProps) {
  const [r, setR] = useState<DOMRect | null>(null);
  const open = !!r;
  const { armed, tryArm, disarm } = useArm<"leave">();
  const close = () => {
    setR(null);
    disarm();
  };
  useDismiss(open, "#tc-root .tc-opts-menu, #tc-root .tc-opts-btn", close);

  if (chat.kind === "notes" || chat.app) return null;
  const manage = chat.group && !chat.left;

  return (
    <>
      <button
        className={"tc-ghost tc-icon-only tc-opts-btn" + (open ? " on" : "")}
        onClick={(e) => (open ? close() : setR(e.currentTarget.getBoundingClientRect()))}
        title={t().chat.options}
        aria-label={t().chat.options}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={15} />
      </button>
      {r ? (
        <div className="tc-menu tc-opts-menu" role="menu" style={menuPos(r.right, r.top, r.bottom, 220, 6, "right")}>
          <MenuItem
            icon={chat.favorite ? <StarOff size={14} /> : <Star size={14} />}
            close={close}
            onPick={() => onSetFavorite(chat, !chat.favorite)}
          >
            {chat.favorite ? t().sidebar.removeFavorite : t().sidebar.addFavorite}
          </MenuItem>
          <div className="tc-menu-sep" />
          {chat.isChannel ? (
            <>
              <ChannelPresets chat={chat} flash={flash} onDone={close} />
              <ChannelLeaveItem
                chat={chat}
                onLeave={onLeave}
                onNewChannel={onNewChannel}
                onRename={onRename}
                onMembers={onMembers}
                onDone={close}
              />
            </>
          ) : (
            <>
              {manage ? (
                <>
                  <MenuItem icon={<Pencil size={14} />} close={close} onPick={onRename}>
                    {t().chat.rename}
                  </MenuItem>
                  <MenuItem icon={<Users size={14} />} close={close} onPick={onMembers}>
                    <span className="tc-menu-grow">{t().chat.members}</span>
                    <span className="tc-menu-count">{chat.members.length + 1}</span>
                  </MenuItem>
                  <div className="tc-menu-sep" />
                </>
              ) : null}
              <MenuItem
                icon={chat.muted ? <Bell size={14} /> : <BellOff size={14} />}
                close={close}
                onPick={() => onSetMuted(chat, !chat.muted)}
              >
                {chat.muted ? t().common.unmute : t().common.mute}
              </MenuItem>
              {manage ? (
                <>
                  <div className="tc-menu-sep" />
                  <MenuItem
                    icon={<LogOut size={14} />}
                    danger
                    armed={!!armed}
                    onPick={() =>
                      tryArm("leave", () => {
                        close();
                        onLeave(chat);
                      })
                    }
                  >
                    {armed ? t().chat.leaveConfirm : t().chat.leave}
                  </MenuItem>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
