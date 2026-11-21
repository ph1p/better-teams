// Channel entries shared by the header "…" menu and the sidebar's right-click
// menu: the notification preset (Teams' "Channel notifications", whose "Off"
// is the channel's mute), then members, rename, leave or hide, and delete. As in Teams,
// a private or shared channel is left on its own, a standard one hidden,
// General neither; the team can be left from any of its channels. Rename,
// delete and adding a channel to the team show only where Teams allows them
// (data/groups.ts getChannelActions).

import { t } from "../../i18n";
import { useEffect, useState, type JSX } from "react";
import { AtSign, Bell, BellOff, Check, EyeOff, LogOut, Pencil, Plus, Trash2, Users } from "lucide-react";
import {
  getChannelActions, getChannelNotifications, setChannelNotifications,
  type ChannelActions, type ChannelNotifications, type ChannelPreset,
} from "../../teamsData";
import { useArm } from "../lib/arm";
import type { Flash } from "../lib/toast";
import type { Chat } from "../../types";

interface Preset { id: ChannelPreset; label: () => string; icon: JSX.Element }

const PRESETS: Preset[] = [
  { id: "ALL_NEW_MSGS", label: () => t().chat.presetAll, icon: <Bell size={14} /> },
  { id: "MENTIONS_AND_REPLIES", label: () => t().chat.presetMentions, icon: <AtSign size={14} /> },
  { id: "MUTE", label: () => t().chat.presetOff, icon: <BellOff size={14} /> },
];

/** Ask Teams once per mount; undefined while loading. */
function useLoad<T>(id: string, load: (id: string) => Promise<T>): T | undefined {
  const [v, setV] = useState<T | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void load(id).then((x) => { if (live) setV(x); });
    return () => { live = false; };
  }, [id, load]);
  return v;
}

export function ChannelPresets({ chat, flash, onDone }: { chat: Chat; flash: Flash; onDone: () => void }): JSX.Element {
  // null: Teams didn't answer (the choice still works).
  const cur = useLoad<ChannelNotifications | null>(chat.id, getChannelNotifications);
  const pick = async (preset: Preset): Promise<void> => {
    onDone();
    const res = await setChannelNotifications(chat.id, preset.id, cur);
    flash(res.ok ? t().chat.presetSet(preset.label()) : t().chat.presetFailed(res.reason), 3000);
  };
  return (
    <>
      <div className="tc-menu-label">{t().chat.channelNotifications}</div>
      {PRESETS.map((p) => (
        <button key={p.id} className="tc-menu-item" role="menuitemradio" aria-checked={cur?.preset === p.id}
          disabled={cur === undefined} onClick={() => void pick(p)}>
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

/**
 * Add a channel to the team, show its members (when `onMembers` is given),
 * rename the channel (when `onRename` is given),
 * leave or hide it, leave its team, delete it; the last three arm on the first
 * click. Nothing shows while Teams is asked or when none is possible.
 */
export function ChannelLeaveItem({ chat, onLeave, onNewChannel, onRename, onMembers, onDone }: {
  chat: Chat; onLeave: (chat: Chat, what: Departure) => void; onNewChannel: (chat: Chat) => void;
  onRename?: () => void; onMembers?: () => void; onDone: () => void;
}): JSX.Element | null {
  const acts = useLoad<ChannelActions | null>(chat.id, getChannelActions);
  const { armed, tryArm } = useArm<Departure>();
  if (!acts || chat.left) return null;
  const rename = acts.rename && !!onRename;
  const members = !!acts.members && !!onMembers;
  if (!acts.channel && !acts.team && !acts.delete && !acts.create && !rename && !members) return null;
  const run = (what: Departure): void => tryArm(what, () => { onDone(); onLeave(chat, what); });
  const hide = acts.channel === "hide";
  return (
    <>
      <div className="tc-menu-sep" />
      {acts.create ? (
        <button className="tc-menu-item" role="menuitem" onClick={() => { onDone(); onNewChannel(chat); }}>
          <Plus size={14} /> {t().chat.newChannel}
        </button>
      ) : null}
      {members ? (
        <button className="tc-menu-item" role="menuitem" onClick={() => { onDone(); onMembers!(); }}>
          <Users size={14} /> {t().chat.channelMembers}
        </button>
      ) : null}
      {rename ? (
        <button className="tc-menu-item" role="menuitem" onClick={() => { onDone(); onRename!(); }}>
          <Pencil size={14} /> {t().chat.renameChannel}
        </button>
      ) : null}
      {acts.channel ? (
        <button className={"tc-menu-item danger" + (armed === "channel" ? " armed" : "")} role="menuitem"
          onClick={() => run("channel")}>
          {hide ? <EyeOff size={14} /> : <LogOut size={14} />}{" "}
          {armed === "channel" ? (hide ? t().chat.hideConfirm : t().chat.leaveConfirm)
            : hide ? t().chat.hideChannel : t().chat.leaveChannel}
        </button>
      ) : null}
      {acts.team ? (
        <button className={"tc-menu-item danger" + (armed === "team" ? " armed" : "")} role="menuitem"
          onClick={() => run("team")}>
          <LogOut size={14} /> {armed === "team" ? t().chat.leaveConfirm : t().chat.leaveTeam(chat.team)}
        </button>
      ) : null}
      {acts.delete ? (
        <button className={"tc-menu-item danger" + (armed === "delete" ? " armed" : "")} role="menuitem"
          onClick={() => run("delete")}>
          <Trash2 size={14} /> {armed === "delete" ? t().chat.deleteConfirm : t().chat.deleteChannel}
        </button>
      ) : null}
    </>
  );
}
