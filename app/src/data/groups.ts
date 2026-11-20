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
import type { ChannelNotifications, ChannelPreset } from "../services/groups";

export type { ChannelNotifications, ChannelPreset };

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
  if (Date.now() - p.at > OVERRIDE_MS) { pending.delete(convId); return idb; }
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
      out.members = [...idb.members.filter((m) => p.members!.get(m) !== false),
        ...[...p.members].filter(([m, inChat]) => inChat && !have.has(m)).map(([m]) => m)];
    } else p.members = undefined;
  }
  if (p.title === undefined && p.muted === undefined && !p.members) pending.delete(convId);
  return out;
}

/** Rename a group chat. Teams trims the name; an empty one is refused. */
export async function renameChat(conversationId: string, title: string): Promise<WriteResult> {
  const t = title.trim();
  if (!t) return { ok: false, reason: "empty name" };
  const r = await groups.setConversationTitle(conversationId, t);
  if (r.ok) touch(conversationId).title = t;
  return toWrite(r, "cdl");
}

export async function addChatMembers(conversationId: string, mris: string[], shareHistoryDays = 0): Promise<WriteResult> {
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
  channelId: string, preset: ChannelPreset, current?: ChannelNotifications | null,
): Promise<WriteResult> {
  return toWrite(await groups.setChannelNotifications(channelId, preset, current ?? undefined), "cdl");
}
