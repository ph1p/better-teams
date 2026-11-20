// Group chat management and notification settings through Teams' web worker
// (cdl.ts): rename, add/remove members, leave, mute a chat, and a channel's
// notification preset. The documents are Teams' own (read from its bundle,
// Nov 2026); each one is served by a worker resolver, which updates the local
// store (and so IndexedDB) as well as the server:
//   setConversationTitle   thread property `topic`
//   setMuteChat            conversation property `alerts` = String(!mute)
//   leaveChat              thread property `lastleaveat`, then removes us
// Teams follows leaveChat with a hide; so do we (data/groups.ts).

import { cdl, check, type CdlRes } from "./cdl";

const RENAME = `mutation ComponentsChatTitleUpdaterSetConversationTitleMutation($convId: ID!, $title: String!) {
  setConversationTitle(convId: $convId, title: $title) { id title __typename }
}`;

const ADD_MEMBERS = `mutation ComponentsChatAddMembersAddMembersToConversationMutation($convId: ID!, $members: [UserInput!]!, $shareHistoryTime: BigInt) {
  addMembersToConversation(convId: $convId, members: $members, shareHistoryTime: $shareHistoryTime, isChannelThread: false) {
    __typename
  }
}`;

const REMOVE_MEMBER = `mutation ComponentsChatRosterRemoveMemberFromConversationMutation($convId: ID!, $userToRemove: ID!) {
  removeMemberFromConversation(convId: $convId, userId: $userToRemove) { userId hasChatPermissionsPolicyRejectedUsers __typename }
}`;

const LEAVE = `mutation ComponentsChatOptionsSharedLeaveChatMutation($convId: ID!) {
  leaveChat(convId: $convId) { id isUserMember memberIds __typename }
}`;

const MUTE = `mutation ComponentsChatOptionsSharedSetMuteChatMutation($convId: ID!, $mute: Boolean!) {
  setMuteChat(convId: $convId, mute: $mute) { id isMuted __typename }
}`;

const CHANNEL_NOTIF_GET = `query channelNotificationSettingsPopoverQuery($channelId: ID!) {
  channelConversationById(channelId: $channelId) {
    __typename
    id
    notificationAndFollowSettings {
      channelGranularSetting { channelPreset globalTagMentions globalChannelTeamMentions isCustomized desktopNotifications source }
    }
  }
}`;

const CHANNEL_NOTIF_SET = `mutation channelGranularSettingsMutation($input: OneGQL_SetFollowNotificationSettingsInput!) {
  setFollowNotificationSettings(input: $input) {
    __typename
    ... on OneGQL_SetFollowNotificationSettingsError { errorMessage }
    ... on OneGQL_SetFollowNotificationSettingsSuccess { convId }
  }
}`;

type Data = Record<string, unknown>;

/** The named field of a mutation's result, or a failure naming the error type. */
function field(r: CdlRes<Data>, name: string): CdlRes<true> {
  const c = check(r, name, /Error$/);
  return c.ok ? { ok: true, data: true } : c;
}

export async function setConversationTitle(convId: string, title: string): Promise<CdlRes<true>> {
  return field(await cdl<Data>("ComponentsChatTitleUpdaterSetConversationTitleMutation", RENAME, { convId, title }), "setConversationTitle");
}

/**
 * Add people (MRIs) to a group chat. `shareHistoryDays`: -1 none, 0 all,
 * N the last N days (Teams' own encoding; the worker turns N into a time).
 */
export async function addMembers(convId: string, mris: string[], shareHistoryDays = 0): Promise<CdlRes<true>> {
  return field(await cdl<Data>("ComponentsChatAddMembersAddMembersToConversationMutation", ADD_MEMBERS, {
    convId,
    members: mris.map((id) => ({ id })),
    shareHistoryTime: shareHistoryDays,
  }), "addMembersToConversation");
}

export async function removeMember(convId: string, mri: string): Promise<CdlRes<true>> {
  return field(await cdl<Data>("ComponentsChatRosterRemoveMemberFromConversationMutation", REMOVE_MEMBER, {
    convId, userToRemove: mri,
  }), "removeMemberFromConversation");
}

export async function leaveChat(convId: string): Promise<CdlRes<true>> {
  return field(await cdl<Data>("ComponentsChatOptionsSharedLeaveChatMutation", LEAVE, { convId }), "leaveChat");
}

export async function setMuteChat(convId: string, mute: boolean): Promise<CdlRes<true>> {
  return field(await cdl<Data>("ComponentsChatOptionsSharedSetMuteChatMutation", MUTE, { convId, mute }), "setMuteChat");
}

/** Teams' channel notification presets (the "Channel notifications" menu). */
export type ChannelPreset = "ALL_NEW_MSGS" | "MENTIONS_AND_REPLIES" | "MUTE";

export interface ChannelNotifications {
  preset: ChannelPreset | string;
  tagMentions: boolean;
  channelTeamMentions: boolean;
  customized: boolean;
}

export async function getChannelNotifications(channelId: string): Promise<CdlRes<ChannelNotifications>> {
  const r = await cdl<Data>("channelNotificationSettingsPopoverQuery", CHANNEL_NOTIF_GET, { channelId });
  if (!r.ok) return r;
  const ch = r.data.channelConversationById as { notificationAndFollowSettings?: { channelGranularSetting?: Data } } | null;
  const s = ch?.notificationAndFollowSettings?.channelGranularSetting;
  if (!s) return { ok: false, reason: "no channel notification settings" };
  return {
    ok: true,
    data: {
      preset: String(s.channelPreset ?? ""),
      tagMentions: s.globalTagMentions !== false,
      channelTeamMentions: s.globalChannelTeamMentions !== false,
      customized: s.isCustomized === true,
    },
  };
}

/** Set a channel's preset, keeping its @tag / @channel-@team mention choices. */
export async function setChannelNotifications(
  convId: string, preset: ChannelPreset, keep?: Pick<ChannelNotifications, "tagMentions" | "channelTeamMentions">,
): Promise<CdlRes<true>> {
  return field(await cdl<Data>("channelGranularSettingsMutation", CHANNEL_NOTIF_SET, {
    input: {
      convId,
      channelGranularSetting: {
        channelPreset: preset,
        followThreads: preset !== "MUTE",
        tagMentions: keep?.tagMentions ?? true,
        channelTeamMentions: keep?.channelTeamMentions ?? true,
        desktopNotifications: "FOLLOW_GNS",
      },
    },
  }), "setFollowNotificationSettings");
}
