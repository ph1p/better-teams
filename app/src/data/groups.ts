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
import { t } from "../i18n";
import type { ChannelNotifications, ChannelPreset, ThreadMember } from "../services/groups";

export type { ChannelNotifications, ChannelPreset };
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
  create: boolean;
  channelId: string;
  // Team thread id (19:…@thread.tacv2) and its M365 group id.
  teamId: string;
  groupId: string;
  // null for none (shared channels).
  members: "team" | "channel" | null;
  // Removing: owners only.
  addMembers: boolean;
  removeMembers: boolean;
  // Team owners; a private channel takes only team members, so outsiders
  // join the team first.
  addTeamMembers: boolean;
}

const OVERRIDE_MS = 60_000;

interface Pending {
  title?: string;
  muted?: boolean;
  // MRI -> added (true) or removed (false).
  members?: Map<string, boolean>;
  at: number;
}

const pending = new Map<string, Pending>();

function touch(convId: string) {
  let p = pending.get(convId);
  if (!p || Date.now() - p.at > OVERRIDE_MS) pending.set(convId, (p = { at: Date.now() }));
  else p.at = Date.now();
  return p;
}

// Each field's override drops once IndexedDB shows the same value.
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

// Teams trims the name; an empty one is refused.
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

export async function removeChatMember(conversationId: string, mri: string) {
  const r = await groups.removeMember(conversationId, mri);
  if (r.ok) (touch(conversationId).members ??= new Map()).set(mri, false);
  return toWrite(r, "cdl");
}

// Then hide it, as Teams does.
export async function leaveChat(conversationId: string): Promise<WriteResult> {
  const r = await groups.leaveChat(conversationId);
  if (!r.ok) return toWrite(r, "cdl");
  await setChatHidden(conversationId, true);
  return { ok: true, via: "cdl" };
}

// Channel visibility set this session (true = shown). IndexedDB carries it in
// the channel's favorite property only after a sync; until it agrees (or
// OVERRIDE_MS passes) this value wins.
const shownOverride = new Map<string, { at: number; shown: boolean }>();

export function effectiveShown(convId: string, idbShown: boolean) {
  const ov = shownOverride.get(convId);
  if (!ov) return idbShown;
  if (ov.shown === idbShown || Date.now() - ov.at > OVERRIDE_MS) {
    shownOverride.delete(convId);
    return idbShown;
  }
  return ov.shown;
}

export interface TeamChannel {
  id: string;
  name: string;
  general: boolean;
  // The team owner shows it to members by default (Teams' "Recommended").
  recommended: boolean;
  shown: boolean;
}

export async function getTeamChannels(teamId: string): Promise<TeamChannel[] | null> {
  const r = await groups.getTeamChannels(teamId);
  if (!r.ok) return null;
  return r.data.map((c) => ({
    id: c.id,
    name: c.displayName,
    general: c.isGeneral || c.id === teamId,
    recommended: c.isShownByDefault,
    shown: effectiveShown(c.id, c.isShown !== false),
  }));
}

export async function setChannelShown(channelId: string, shown: boolean) {
  const r = await groups.setChannelVisibility(channelId, shown);
  if (r.ok) {
    shownOverride.set(channelId, { at: Date.now(), shown });
    actionsCache.delete(channelId);
  }
  return toWrite(r, "cdl");
}

// Channels we left and teams we left this session. IndexedDB shows it
// (lastleaveat, the favorite property) only after a sync; until then
// listChats skips them here.
const departed = new Set<string>();

export function isDeparted(convId: string, teamId?: string) {
  return departed.has(convId) || (!!teamId && departed.has(teamId));
}

// The answer barely changes; the menu asks on open and the action again on click.
const actionsCache = new Map<string, { at: number; v: ChannelActions | null }>();

export async function getChannelActions(channelId: string) {
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
    addTeamMembers: false,
  };
  const teamOwner = i.teamRole === "ADMIN";
  v.addTeamMembers = teamOwner && i.canAddTeamMember && !!i.teamId && !!i.groupId;
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

export async function leaveChannel(a: ChannelActions): Promise<WriteResult> {
  if (!a.channel) return { ok: false, reason: "can't leave this channel" };
  // A hidden channel stays listed (hidden), so it can be shown again.
  if (a.channel === "hide") return setChannelShown(a.channelId, false);
  const r = await groups.leaveChannel(a.channelId, a.teamId);
  if (r.ok) {
    departed.add(a.channelId);
    actionsCache.delete(a.channelId);
  }
  return toWrite(r, "cdl");
}

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

// `id` is "" when Teams didn't report it yet.
export type CreateResult = { ok: true; id: string } | { ok: false; reason: string };

// `threads` picks Teams' threads layout over posts.
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

// Rosters, shared by the members panel and the @-picker; keyed by thread id
// (the team's or the channel's). Our own adds and removals drop the entry.
const rosterCache = new Map<string, { at: number; v: Promise<ChannelMember[] | null> }>();
const ROSTER_MS = 5 * 60_000;
const rosterId = (a: ChannelActions) => (a.members === "team" ? a.teamId : a.channelId);

// People only, bots and apps left out.
export function listChannelMembers(a: ChannelActions): Promise<ChannelMember[] | null> {
  if (!a.members) return Promise.resolve(null);
  const id = rosterId(a);
  const hit = rosterCache.get(id);
  if (hit && Date.now() - hit.at < ROSTER_MS) return hit.v;
  const v = groups.listThreadMembers(id).then((r) => (r.ok ? r.data.filter((m) => m.mri.startsWith("8:")) : null));
  const entry = { at: Date.now(), v };
  rosterCache.set(id, entry);
  // A failed load is asked again next time.
  void v.then((ms) => ms || rosterCache.get(id) !== entry || rosterCache.delete(id));
  return v;
}

// MRIs compare case-insensitively.
async function outsideTeam(a: ChannelActions, mris: string[]) {
  const team = await listChannelMembers({ ...a, members: "team" });
  if (!team) return [];
  const inTeam = new Set(team.map((m) => m.mri.toLowerCase()));
  return mris.filter((m) => !inTeam.has(m.toLowerCase()));
}

// For a private channel, anyone not in its team joins the team first: Teams
// refuses them otherwise.
export async function addChannelMembers(a: ChannelActions, mris: string[]): Promise<WriteResult> {
  if (!a.addMembers || !a.members) return { ok: false, reason: "can't add members here" };
  if (!mris.length) return { ok: true };
  try {
    return await addTo(a, mris);
  } finally {
    rosterCache.delete(rosterId(a));
    rosterCache.delete(a.teamId);
  }
}

async function addTo(a: ChannelActions, mris: string[]): Promise<WriteResult> {
  const team = { teamId: a.teamId, groupId: a.groupId };
  const channel = a.members === "channel";
  const failed = (r: { ok: true; data: { error: string }[] }): WriteResult | null =>
    r.data.length ? { ok: false, reason: [...new Set(r.data.map((e) => e.error))].join(", ") } : null;
  const outsiders = channel ? await outsideTeam(a, mris) : [];
  if (outsiders.length) {
    if (!a.addTeamMembers) return { ok: false, reason: t().app.notInTeam };
    const r = await groups.addThreadMembers(team, null, outsiders);
    if (!r.ok) return toWrite(r, "cdl");
    const f = failed(r);
    if (f) return f;
  }
  // Teams answers 400 (RequireStatusFailed) for anyone not in the team yet;
  // fresh team members can take a moment to count, so retry a few times then.
  const tries = outsiders.length ? 4 : 1;
  for (let i = 0; ; i++) {
    const r = await groups.addThreadMembers(team, channel ? a.channelId : null, mris);
    if (r.ok) return failed(r) ?? { ok: true, via: "cdl" };
    const notInTeam = channel && /RequireStatusFailed/.test(r.reason);
    if (notInTeam && i + 1 < tries) {
      await new Promise((res) => setTimeout(res, 2_000 * (i + 1)));
      continue;
    }
    return notInTeam ? { ok: false, reason: t().app.notInTeam } : toWrite(r, "cdl");
  }
}

export async function removeChannelMember(a: ChannelActions, m: ChannelMember) {
  if (!a.removeMembers || !a.members) return { ok: false, reason: "can't remove members here" };
  const team = a.members === "team";
  const r = toWrite(await groups.removeThreadMember(team ? a.teamId : a.channelId, team ? a.groupId : null, m), "cdl");
  rosterCache.delete(rosterId(a));
  return r;
}

export async function leaveTeam(a: ChannelActions): Promise<WriteResult> {
  if (!a.team) return { ok: false, reason: "can't leave this team" };
  const r = await groups.leaveTeam(a.teamId, a.groupId);
  if (r.ok) {
    departed.add(a.teamId);
    actionsCache.clear();
    rosterCache.clear();
  }
  return toWrite(r, "cdl");
}

// Channels use setChannelNotifications.
export async function setChatMuted(conversationId: string, muted: boolean): Promise<WriteResult> {
  if (isChannelId(conversationId)) return { ok: false, reason: "use channel notifications" };
  const r = await groups.setMuteChat(conversationId, muted);
  if (r.ok) touch(conversationId).muted = muted;
  return toWrite(r, "cdl");
}

export async function getChannelNotifications(channelId: string) {
  const r = await groups.getChannelNotifications(channelId);
  return r.ok ? r.data : null;
}

export async function setChannelNotifications(
  channelId: string,
  preset: ChannelPreset,
  current?: ChannelNotifications | null,
) {
  return toWrite(await groups.setChannelNotifications(channelId, preset, current ?? undefined), "cdl");
}
