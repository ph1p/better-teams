// The "…" menu in the chat header: rename, members, mute and leave for chats;
// the notification preset, rename, leave and delete for channels (ChannelItems.tsx). Leave arms on the first click and
// acts on the second, like removing a file (lib/arm.ts).

import { t } from "../../i18n";
import { useRef, useState, type JSX } from "react";
import { Bell, BellOff, LogOut, MoreHorizontal, Pencil, Users } from "lucide-react";
import { ChannelLeaveItem, ChannelPresets } from "./ChannelItems";
import { useDismiss } from "../lib/dismiss";
import { useArm } from "../lib/arm";
import type { Flash } from "../lib/toast";
import type { Chat } from "../../types";

interface ChatOptionsProps {
  chat: Chat;
  flash: Flash;
  onRename: () => void;
  onMembers: () => void;
  onSetMuted: (chat: Chat, muted: boolean) => void;
  onLeave: (chat: Chat, what?: "channel" | "team" | "delete") => void;
  onNewChannel: (chat: Chat) => void;
}

export function ChatOptions({ chat, flash, onRename, onMembers, onSetMuted, onLeave, onNewChannel }: ChatOptionsProps): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const { armed, tryArm, disarm } = useArm<"leave">();
  const btn = useRef<HTMLButtonElement>(null);
  const close = (): void => { setOpen(false); disarm(); };
  useDismiss(open, "#tc-root .tc-opts-menu, #tc-root .tc-opts-btn", close);

  if (chat.kind === "notes" || chat.app) return null;
  const r = open ? btn.current?.getBoundingClientRect() : undefined;
  const act = (fn: () => void) => (): void => { close(); fn(); };
  // Rename, members and leave only make sense in a group chat we're still in.
  const manage = chat.group && !chat.left;

  return (
    <>
      <button
        ref={btn}
        className={"tc-ghost tc-icon-only tc-opts-btn" + (open ? " on" : "")}
        onClick={() => (open ? close() : setOpen(true))}
        title={t().chat.options}
        aria-label={t().chat.options}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && r ? (
        <div className="tc-menu tc-opts-menu" role="menu" style={{ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) }}>
          {chat.isChannel ? (
            <>
              <ChannelPresets chat={chat} flash={flash} onDone={close} />
              <ChannelLeaveItem chat={chat} onLeave={onLeave} onNewChannel={onNewChannel} onRename={onRename} onDone={close} />
            </>
          ) : (
            <>
              {manage ? (
                <>
                  <button className="tc-menu-item" role="menuitem" onClick={act(onRename)}><Pencil size={14} /> {t().chat.rename}</button>
                  <button className="tc-menu-item" role="menuitem" onClick={act(onMembers)}>
                    <Users size={14} /> <span className="tc-menu-grow">{t().chat.members}</span>
                    <span className="tc-menu-count">{chat.members.length + 1}</span>
                  </button>
                </>
              ) : null}
              <button className="tc-menu-item" role="menuitem" onClick={act(() => onSetMuted(chat, !chat.muted))}>
                {chat.muted ? <Bell size={14} /> : <BellOff size={14} />} {chat.muted ? t().common.unmute : t().common.mute}
              </button>
              {manage ? (
                <>
                  <div className="tc-menu-sep" />
                  <button
                    className={"tc-menu-item danger" + (armed ? " armed" : "")}
                    role="menuitem"
                    onClick={() => tryArm("leave", () => { close(); onLeave(chat); })}
                  >
                    <LogOut size={14} /> {armed ? t().chat.leaveConfirm : t().chat.leave}
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
