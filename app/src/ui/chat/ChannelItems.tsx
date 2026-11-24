// Teams' "Channel notifications" preset "Off" is the channel's mute. As in
// Teams, a private or shared channel is left on its own, a standard one hidden,
// General neither; the team can be left from any of its channels. Rename,
// delete and adding a channel show only where Teams allows them
// (data/groups.ts getChannelActions).

import { t } from "../../i18n";
import type { JSX } from "react";
import { AtSign, Bell, BellOff, Check, EyeOff, LogOut, Pencil, Plus, Trash2, Users } from "lucide-react";
import {
  getChannelActions,
  getChannelNotifications,
  setChannelNotifications,
  type ChannelActions,
  type ChannelNotifications,
  type ChannelPreset,
} from "../../teamsData";
import { useArm } from "../lib/arm";
import { useLoad } from "../lib/load";
import { MenuItem } from "../shared/MenuItem";
import type { Flash } from "../lib/toast";
import type { Chat } from "../../types";

interface Preset {
  id: ChannelPreset;
  label: () => string;
  icon: JSX.Element;
}

const PRESETS: Preset[] = [
  { id: "ALL_NEW_MSGS", label: () => t().chat.presetAll, icon: <Bell size={14} /> },
  { id: "MENTIONS_AND_REPLIES", label: () => t().chat.presetMentions, icon: <AtSign size={14} /> },
  { id: "MUTE", label: () => t().chat.presetOff, icon: <BellOff size={14} /> },
];

export function ChannelPresets({ chat, flash, onDone }: { chat: Chat; flash: Flash; onDone: () => void }) {
  // null: Teams didn't answer (the choice still works).
  const [cur] = useLoad<ChannelNotifications | null>(chat.id, getChannelNotifications);
  const pick = async (preset: Preset) => {
    onDone();
    const res = await setChannelNotifications(chat.id, preset.id, cur);
    flash(res.ok ? t().chat.presetSet(preset.label()) : t().chat.presetFailed(res.reason), 3000);
  };
  return (
    <>
      <div className="tc-menu-label">{t().chat.channelNotifications}</div>
      {PRESETS.map((p) => (
        <button
          key={p.id}
          className="tc-menu-item"
          role="menuitemradio"
          aria-checked={cur?.preset === p.id}
          disabled={cur === undefined}
          onClick={() => void pick(p)}
        >
          {p.icon}
          <span className="tc-menu-grow">{p.label()}</span>
          {cur?.preset === p.id ? <Check size={14} className="tc-menu-check" /> : null}
        </button>
      ))}
      {cur?.customized ? <div className="tc-menu-note">{t().chat.presetCustom}</div> : null}
    </>
  );
}

type Departure = "channel" | "team" | "delete";

export function ChannelLeaveItem({
  chat,
  onLeave,
  onNewChannel,
  onRename,
  onMembers,
  onDone,
}: {
  chat: Chat;
  onLeave: (chat: Chat, what: Departure) => void;
  onNewChannel: (chat: Chat) => void;
  onRename?: () => void;
  onMembers?: () => void;
  onDone: () => void;
}) {
  const [acts] = useLoad<ChannelActions | null>(chat.id, getChannelActions);
  const { armed, tryArm } = useArm<Departure>();
  if (!acts || chat.left) return null;
  const rename = acts.rename && !!onRename;
  const members = !!acts.members && !!onMembers;
  if (!acts.channel && !acts.team && !acts.delete && !acts.create && !rename && !members) return null;
  const run = (what: Departure) =>
    tryArm(what, () => {
      onDone();
      onLeave(chat, what);
    });
  const hide = acts.channel === "hide";
  const leave = acts.channel === "leave";
  const channel = members || rename || hide;
  const drop = leave || acts.delete;
  const team = acts.create || acts.team;
  const item = (icon: JSX.Element, label: string, fn: () => void) => (
    <MenuItem icon={icon} close={onDone} onPick={fn}>
      {label}
    </MenuItem>
  );
  const danger = (what: Departure, icon: JSX.Element, label: string, confirm: string) => (
    <MenuItem icon={icon} danger armed={armed === what} onPick={() => run(what)}>
      {armed === what ? confirm : label}
    </MenuItem>
  );
  return (
    <>
      {channel ? (
        <>
          <div className="tc-menu-sep" />
          {members ? item(<Users size={14} />, t().chat.channelMembers, onMembers!) : null}
          {rename ? item(<Pencil size={14} />, t().chat.renameChannel, onRename!) : null}
          {/* Hiding is undone from the team's channel list, so it needs no second click. */}
          {hide ? item(<EyeOff size={14} />, t().chat.hideChannel, () => onLeave(chat, "channel")) : null}
        </>
      ) : null}
      {drop ? (
        <>
          <div className="tc-menu-sep" />
          {leave ? danger("channel", <LogOut size={14} />, t().chat.leaveChannel, t().chat.leaveConfirm) : null}
          {acts.delete ? danger("delete", <Trash2 size={14} />, t().chat.deleteChannel, t().chat.deleteConfirm) : null}
        </>
      ) : null}
      {team ? (
        <>
          <div className="tc-menu-sep" />
          <div className="tc-menu-label">{chat.team || t().sidebar.otherTeam}</div>
          {acts.create ? item(<Plus size={14} />, t().chat.newChannel, () => onNewChannel(chat)) : null}
          {acts.team ? danger("team", <LogOut size={14} />, t().chat.leaveTeam, t().chat.leaveConfirm) : null}
        </>
      ) : null}
    </>
  );
}
