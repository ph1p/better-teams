// Group chat management and notifications: rename, members, leave, mute, and
// a channel's notification preset. The worker writes these into Teams' local
// store, but listChats reads IndexedDB, which can trail the write by a poll or
// two. Until it catches up, a short-lived override keeps the new value on
// screen (dropped once IndexedDB agrees, or after OVERRIDE_MS regardless).
import type { WriteResult } from "../types";
import { groups } from "../services";
import { setChatHidden } from "./readState";
import { isChannelId } from "./state";
import { toWrite } from "./raw";
import type { ChannelNotifications, ChannelPreset, ThreadMember } from "../services/groups";

export type { ChannelNotifications, ChannelPreset };
/** One person on a team's or private channel's roster. */
export type ChannelMember = ThreadMember;

/**
 * What the channel menus offer, as in Teams: a private or shared channel is
 * left on its own, a standard one only hidden, General neither. The team can
 * be left from any of its channels, General included. Renaming and deleting
 * follow Teams' own canEdit / canDelete for the channel, adding a channel the
 * team's canAddChannel. Members: a standard channel (General too) shows its
 * team's roster, a private one its own; shared channels none.
 */
export interface ChannelActions {
  channel: "leave" | "hide" | null;
  team: boolean;
  rename: boolean;
  delete: boolean;
  /** A new channel can be added to this channel's team. */
  create: boolean;
  channelId: string;
  /** Team thread id (19:…@thread.tacv2) and its M365 group id. */
  teamId: string;
  groupId: string;
  /** Whose roster the members panel shows; null for none (shared channels). */
  members: "team" | "channel" | null;
  /** We may add people to that roster, or remove them (owners only). */
  addMembers: boolean;
  removeMembers: boolean;
}

const OVERRIDE_MS = 60_000;

interface Pending {
  title?: string;
  muted?: boolean;
  /** Members we added (true) or removed (false), by MRI. */
  members?: Map<string, boolean>;
  at: number;
}

const pending = new Map<string, Pending>();

function touch(convId: string): Pending {
  let p = pending.get(convId);
  if (!p || Date.now() - p.at > OVERRIDE_MS) pending.set(convId, (p = { at: Date.now() }));
  else p.at = Date.now();
  return p;
}

/**
 * Apply pending writes to what IndexedDB says about a chat. Each field's
 * override drops once IndexedDB shows the same value.
 */
export function withPending<T extends { title: string; muted: boolean; members: string[] }>(convId: string, idb: T): T {
  const p = pending.get(convId);
  if (!p) return idb;
  if (Date.now() - p.at > OVERRIDE_MS) {
    pending.delete(convId);
    return idb;
  }
  const out = { ...idb };
  if (p.title !== undefined) {
    if (idb.title === p.title) p.title = undefined;
    else out.title = p.title;
  }
  if (p.muted !== undefined) {
    if (idb.muted === p.muted) p.muted = undefined;
    else out.muted = p.muted;
  }
  if (p.members) {
    const have = new Set(idb.members);
    for (const [mri, inChat] of p.members) if (have.has(mri) === inChat) p.members.delete(mri);
    if (p.members.size) {
      out.members = [
        ...idb.members.filter((m) => p.members!.get(m) !== false),
        ...[...p.members].filter(([m, inChat]) => inChat && !have.has(m)).map(([m]) => m),
      ];
    } else p.members = undefined;
  }
  if (p.title === undefined && p.muted === undefined && !p.members) pending.delete(convId);
  return out;
}

/** Rename a group chat or a channel. Teams trims the name; an empty one is refused. */
export async function renameChat(conversationId: string, title: string): Promise<WriteResult> {
  const t = title.trim();
  if (!t) return { ok: false, reason: "empty name" };
  const r = isChannelId(conversationId)
    ? await groups.renameChannel(conversationId, t)
    : await groups.setConversationTitle(conversationId, t);
  if (r.ok) touch(conversationId).title = t;
  return toWrite(r, "cdl");
}

export async function addChatMembers(
  conversationId: string,
  mris: string[],
  shareHistoryDays = 0,
): Promise<WriteResult> {
  if (!mris.length) return { ok: true };
  const r = await groups.addMembers(conversationId, mris, shareHistoryDays);
  if (r.ok) {
    const p = touch(conversationId);
    p.members ??= new Map();
    for (const m of mris) p.members.set(m, true);
  }
  return toWrite(r, "cdl");
}

export async function removeChatMember(conversationId: string, mri: string): Promise<WriteResult> {
  const r = await groups.removeMember(conversationId, mri);
  if (r.ok) (touch(conversationId).members ??= new Map()).set(mri, false);
  return toWrite(r, "cdl");
}

/** Leave a group chat, then hide it, as Teams does. */
export async function leaveChat(conversationId: string): Promise<WriteResult> {
  const r = await groups.leaveChat(conversationId);
  if (!r.ok) return toWrite(r, "cdl");
  await setChatHidden(conversationId, true);
  return { ok: true, via: "cdl" };
}

// Channels we left or hid and teams we left this session. IndexedDB shows it
// (lastleaveat, the favorite property) only after a sync; until then
// listChats skips them here.
const departed = new Set<string>();

/** True when we left or hid this channel, or left the team with this thread id, just now. */
export function isDeparted(convId: string, teamId?: string): boolean {
  return departed.has(convId) || (!!teamId && departed.has(teamId));
}

// The answer barely changes; the menu asks on open and the action again on click.
const actionsCache = new Map<string, { at: number; v: ChannelActions | null }>();

/** What can be left or hidden for a channel; null when Teams doesn't say. */
export async function getChannelActions(channelId: string): Promise<ChannelActions | null> {
  const hit = actionsCache.get(channelId);
  if (hit && Date.now() - hit.at < OVERRIDE_MS) return hit.v;
  const r = await groups.getChannelInfo(channelId);
  if (!r.ok) return null;
  const i = r.data;
  const v: ChannelActions = {
    channel: i.isGeneral ? null : i.channelType === "STANDARD" ? "hide" : i.canLeaveChannel ? "leave" : null,
    team: i.canLeaveTeam && !!i.teamId,
    rename: i.canEdit,
    delete: i.canDelete && !i.isGeneral,
    create: i.canAddChannel && !!i.teamId && !!i.groupId,
    channelId,
    teamId: i.teamId,
    groupId: i.groupId,
    members: null,
    addMembers: false,
    removeMembers: false,
  };
  const teamOwner = i.teamRole === "ADMIN";
  if (i.channelType === "STANDARD" || i.isGeneral) {
    if (i.teamId)
      Object.assign(v, {
        members: "team",
        addMembers: teamOwner && i.canAddTeamMember && !!i.groupId,
        removeMembers: teamOwner && !!i.groupId,
      });
  } else if (i.channelType === "PRIVATE") {
    Object.assign(v, {
      members: "channel",
      addMembers: i.canAddMembers && !!i.teamId,
      removeMembers: i.channelRole === "ADMIN",
    });
  }
  actionsCache.set(channelId, { at: Date.now(), v });
  return v;
}

/** Leave or hide the channel itself, as getChannelActions decided. */
export async function leaveChannel(a: ChannelActions): Promise<WriteResult> {
  if (!a.channel) return { ok: false, reason: "can't leave this channel" };
  const r =
    a.channel === "leave"
      ? await groups.leaveChannel(a.channelId, a.teamId)
      : await groups.setChannelVisibility(a.channelId, false);
  if (r.ok) {
    departed.add(a.channelId);
    actionsCache.delete(a.channelId);
  }
  return toWrite(r, "cdl");
}

/** Delete the channel for the whole team. */
export async function deleteChannel(a: ChannelActions): Promise<WriteResult> {
  if (!a.delete) return { ok: false, reason: "can't delete this channel" };
  const i = await groups.getChannelInfo(a.channelId);
  if (!i.ok) return toWrite(i, "cdl");
  const r = await groups.deleteChannel(a.channelId, i.data);
  if (r.ok) {
    departed.add(a.channelId);
    actionsCache.delete(a.channelId);
  }
  return toWrite(r, "cdl");
}

/** A new channel's thread id; "" when Teams didn't report it yet. */
export type CreateResult = { ok: true; id: string } | { ok: false; reason: string };

/** Add a channel to the team `a` belongs to; `threads` picks Teams' threads layout over posts. */
export async function createChannel(
  a: ChannelActions,
  name: string,
  description: string,
  isPrivate: boolean,
  threads: boolean,
): Promise<CreateResult> {
  const displayName = name.trim();
  if (!a.create) return { ok: false, reason: "can't add channels to this team" };
  if (!displayName) return { ok: false, reason: "name missing" };
  const r = await groups.createChannel(
    { teamId: a.teamId, groupId: a.groupId },
    { displayName, description: description.trim(), isPrivate, threads },
  );
  return r.ok ? { ok: true, id: r.data } : { ok: false, reason: r.reason };
}

/** The roster `a.members` names: people only, bots and apps left out. Null when Teams doesn't say. */
export async function listChannelMembers(a: ChannelActions): Promise<ChannelMember[] | null> {
  if (!a.members) return null;
  const r = await groups.listThreadMembers(a.members === "team" ? a.teamId : a.channelId);
  return r.ok ? r.data.filter((m) => m.mri.startsWith("8:")) : null;
}

/** Add people to the roster `a.members` names. */
export async function addChannelMembers(a: ChannelActions, mris: string[]): Promise<WriteResult> {
  if (!a.addMembers || !a.members) return { ok: false, reason: "can't add members here" };
  if (!mris.length) return { ok: true };
  const r = await groups.addThreadMembers(
    { teamId: a.teamId, groupId: a.groupId },
    a.members === "channel" ? a.channelId : null,
    mris,
  );
  if (!r.ok) return toWrite(r, "cdl");
  if (r.data.length) return { ok: false, reason: [...new Set(r.data.map((e) => e.error))].join(", ") };
  return { ok: true, via: "cdl" };
}

/** Remove someone from the roster `a.members` names. */
export async function removeChannelMember(a: ChannelActions, m: ChannelMember): Promise<WriteResult> {
  if (!a.removeMembers || !a.members) return { ok: false, reason: "can't remove members here" };
  const team = a.members === "team";
  return toWrite(await groups.removeThreadMember(team ? a.teamId : a.channelId, team ? a.groupId : null, m), "cdl");
}

/** Leave the channel's whole team, all its channels with it. */
export async function leaveTeam(a: ChannelActions): Promise<WriteResult> {
  if (!a.team) return { ok: false, reason: "can't leave this team" };
  const r = await groups.leaveTeam(a.teamId, a.groupId);
  if (r.ok) {
    departed.add(a.teamId);
    actionsCache.clear();
  }
  return toWrite(r, "cdl");
}

/** Mute a chat's notifications (Teams' "Mute"). Channels use setChannelNotifications. */
export async function setChatMuted(conversationId: string, muted: boolean): Promise<WriteResult> {
  if (isChannelId(conversationId)) return { ok: false, reason: "use channel notifications" };
  const r = await groups.setMuteChat(conversationId, muted);
  if (r.ok) touch(conversationId).muted = muted;
  return toWrite(r, "cdl");
}

export async function getChannelNotifications(channelId: string): Promise<ChannelNotifications | null> {
  const r = await groups.getChannelNotifications(channelId);
  return r.ok ? r.data : null;
}

export async function setChannelNotifications(
  channelId: string,
  preset: ChannelPreset,
  current?: ChannelNotifications | null,
): Promise<WriteResult> {
  return toWrite(await groups.setChannelNotifications(channelId, preset, current ?? undefined), "cdl");
}
