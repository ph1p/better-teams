// Mock of src/teamsData.ts: same exports, backed by the in-memory store instead
// of Teams' IndexedDB and chatsvc. parity.ts keeps the signatures in sync.
import type { Activity, Chat, FileRef, Message, Profile, Quote, WriteResult } from "../types";
import { parseMentions, type MentionPick } from "../mentions";
import { formatMessage } from "../markdown";
import { buildQuoteHtml } from "../quote";
import { ME, ME_OID, PEOPLE } from "./fixtures";
import * as store from "./store";
import type { ChannelNotifications, ChannelPreset } from "../services/groups";
import type { ChannelActions, ChannelMember, CreateResult } from "../data/groups";

export interface PeopleHit {
  mri: string;
  displayName: string;
  email: string;
  jobTitle: string;
}

const ok: WriteResult = { ok: true, via: "mock" };
const fail = (reason: string): WriteResult => ({ ok: false, reason });
const later = <T>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

export let CURRENT_OID = ME_OID;
export const myMri = (): string => (CURRENT_OID ? "8:orgid:" + CURRENT_OID : "");

/** No photos in the mock: the UI falls back to initials. */
export function profilePhotoUrl(_mri: string): string {
  return "";
}

export async function loadProfiles(): Promise<Record<string, Profile>> {
  return store.profiles;
}

const EMPTY_PROFILE: Profile = {
  displayName: "",
  imageUri: "",
  email: "",
  jobTitle: "",
  department: "",
  officeLocation: "",
};
export function profile(mri: string): Profile {
  return store.profiles[mri] || EMPTY_PROFILE;
}

export async function listChats(): Promise<Chat[]> {
  return store.listChats();
}

export async function listMessages(
  conversationId: string,
  _opts: { channel?: boolean; limit?: number; remoteLimit?: number } = {},
): Promise<Message[] | null> {
  return store.recent(conversationId);
}

export async function fetchOlderRemote(
  conversationId: string,
  _channel = false,
  _before?: string,
): Promise<Message[] | null> {
  return later(store.older(conversationId), 300);
}

export function resetPaging(_conversationId: string): void {}

export async function primeRemote(conversationId: string, _channel = false): Promise<Message[] | null> {
  store.resetPaging(conversationId);
  return [];
}

export async function sendRemote(
  conversationId: string,
  text: string,
  quote: Quote | null,
  mentions: readonly MentionPick[] = [],
  rootId?: string,
): Promise<WriteResult> {
  const body = (text || "").trim();
  if (!body) return fail("empty");
  const mc = formatMessage(body, mentions);
  await later(null);
  const m = store.post(conversationId, ME, buildQuoteHtml(quote) + mc.html, rootId);
  if (m && mc.mentions !== "[]") m.mentions = parseMentions(mc.mentions);
  return m ? ok : fail("unknown chat");
}

export async function searchPeople(query: string, size = 8): Promise<PeopleHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = PEOPLE.filter((p) => p.mri !== ME)
    .filter(
      (p) =>
        p.displayName
          .toLowerCase()
          .split(/\s+/)
          .some((w) => w.startsWith(q)) ||
        p.displayName.toLowerCase().startsWith(q) ||
        p.email.startsWith(q),
    )
    .slice(0, size)
    .map((p) => ({ mri: p.mri, displayName: p.displayName, email: p.email, jobTitle: p.jobTitle }));
  return later(hits, 200);
}

export async function setChatFavorite(conversationId: string, fav: boolean): Promise<WriteResult> {
  return store.setFavorite(conversationId, fav) ? ok : fail("unknown chat");
}

export async function answerChatRequest(c: Chat, action: "Accept" | "Block"): Promise<WriteResult> {
  return store.answerRequest(c.id, action) ? ok : fail("unknown chat");
}

export async function setChatHidden(conversationId: string, hidden: boolean): Promise<WriteResult> {
  return store.setHidden(conversationId, hidden) ? ok : fail("unknown chat");
}

export async function markRead(conversationId: string, _lastMessageMs?: number): Promise<WriteResult> {
  return store.setRead(conversationId, true) ? ok : fail("unknown chat");
}

export async function listActivity(): Promise<Activity[]> {
  return store.activity();
}

export async function markActivityRead(newest: number): Promise<WriteResult> {
  store.setFeedRead(newest + 1);
  return ok;
}

export async function markUnread(conversationId: string, _lastMessageMs?: number): Promise<WriteResult> {
  return store.setRead(conversationId, false) ? ok : fail("unknown chat");
}

export async function setReaction(
  conversationId: string,
  messageId: string,
  key: string,
  add: boolean,
): Promise<WriteResult> {
  return store.react(conversationId, messageId, key, add) ? ok : fail("unknown message");
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<WriteResult> {
  return store.setDeleted(conversationId, messageId, true) ? ok : fail("not yours");
}

export async function removeFiles(conversationId: string, messageId: string, keep: FileRef[]): Promise<WriteResult> {
  return store.setFiles(conversationId, messageId, keep) ? ok : fail("not yours");
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  text: string,
  quoteHtml = "",
  picks: readonly MentionPick[] = [],
): Promise<WriteResult> {
  const mc = formatMessage(text, picks);
  return store.edit(conversationId, messageId, quoteHtml + mc.html, parseMentions(mc.mentions))
    ? ok
    : fail("not yours");
}

export async function undoDelete(conversationId: string, messageId: string): Promise<WriteResult> {
  return store.setDeleted(conversationId, messageId, false) ? ok : fail("not yours");
}

// Group chat management and notifications (src/data/groups.ts).
export type { ChannelNotifications, ChannelPreset, ChannelActions, ChannelMember, CreateResult };

export async function renameChat(conversationId: string, title: string): Promise<WriteResult> {
  const t = title.trim();
  if (!t) return fail("empty name");
  return later(store.setTopic(conversationId, t) ? ok : fail("not a group chat"));
}

export async function addChatMembers(
  conversationId: string,
  mris: string[],
  _shareHistoryDays = 0,
): Promise<WriteResult> {
  return later(store.setMembers(conversationId, mris, []) ? ok : fail("not a group chat"));
}

export async function removeChatMember(conversationId: string, mri: string): Promise<WriteResult> {
  return later(store.setMembers(conversationId, [], [mri]) ? ok : fail("not a group chat"));
}

export async function leaveChat(conversationId: string): Promise<WriteResult> {
  return later(store.setMembers(conversationId, [], [ME]) ? ok : fail("not a group chat"));
}

export async function setChatMuted(conversationId: string, muted: boolean): Promise<WriteResult> {
  return later(store.setMuted(conversationId, muted) ? ok : fail("unknown chat"));
}

export async function getChannelNotifications(channelId: string): Promise<ChannelNotifications | null> {
  const preset = store.channelPreset(channelId);
  return later(preset ? { preset, tagMentions: true, channelTeamMentions: true, customized: false } : null);
}

export async function setChannelNotifications(
  channelId: string,
  preset: ChannelPreset,
  _current?: ChannelNotifications | null,
): Promise<WriteResult> {
  return later(store.channelPreset(channelId, preset) ? ok : fail("not a channel"));
}

// General can only be left with its team, and not deleted; ids with "private"
// act as private channels (left on their own), the rest as standard ones
// (hidden). Every channel can be renamed, and its members managed.
export async function getChannelActions(channelId: string): Promise<ChannelActions | null> {
  const general = /-general@/.test(channelId);
  const channel = general ? null : /private/.test(channelId) ? "leave" : "hide";
  return later(
    store.channelPreset(channelId)
      ? {
          channel,
          team: true,
          rename: true,
          delete: !general,
          create: true,
          channelId,
          teamId: channelId,
          groupId: "",
          members: channel === "leave" ? "channel" : "team",
          addMembers: true,
          removeMembers: true,
        }
      : null,
  );
}

export async function deleteChannel(a: ChannelActions): Promise<WriteResult> {
  if (!a.delete) return later(fail("can't delete this channel"));
  return later(store.leaveChannel(a.channelId, false) ? ok : fail("not a channel"));
}

export async function createChannel(
  a: ChannelActions,
  name: string,
  _description: string,
  isPrivate: boolean,
  _threads: boolean,
): Promise<CreateResult> {
  void _description;
  void _threads;
  const id = name.trim() ? store.addChannel(a.channelId, name.trim(), isPrivate) : "";
  return later(id ? { ok: true, id } : { ok: false, reason: "can't add a channel here" });
}

export async function leaveChannel(a: ChannelActions): Promise<WriteResult> {
  if (!a.channel) return later(fail("can't leave this channel"));
  return later(store.leaveChannel(a.channelId, false) ? ok : fail("not a channel"));
}

export async function leaveTeam(a: ChannelActions): Promise<WriteResult> {
  return later(store.leaveChannel(a.channelId, true) ? ok : fail("not a channel"));
}

export async function listChannelMembers(a: ChannelActions): Promise<ChannelMember[] | null> {
  const ms = store.channelMembers(a.channelId);
  return later(
    ms &&
      ms
        .filter((m) => m.startsWith("8:"))
        .map((mri, i) => ({
          mri,
          displayName: profile(mri).displayName || mri,
          jobTitle: profile(mri).jobTitle,
          role: mri === ME || i === 0 ? "Admin" : "User",
          objectId: "",
          tenantId: "",
        })),
    250,
  );
}

export async function addChannelMembers(a: ChannelActions, mris: string[]): Promise<WriteResult> {
  if (!a.addMembers) return later(fail("can't add members here"));
  return later(store.channelMembers(a.channelId, mris) ? ok : fail("not a channel"), 400);
}

export async function removeChannelMember(a: ChannelActions, m: ChannelMember): Promise<WriteResult> {
  if (!a.removeMembers) return later(fail("can't remove members here"));
  return later(store.channelMembers(a.channelId, [], [m.mri]) ? ok : fail("not a channel"), 400);
}
