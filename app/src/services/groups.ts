// Group chat management and notification settings through Teams' web worker
// (cdl.ts): rename, add/remove members, leave, mute a chat, and a channel's
// notification preset. The documents are Teams' own (read from its bundle,
// Nov 2026); each one is served by a worker resolver, which updates the local
// store (and so IndexedDB) as well as the server:
//   setConversationTitle   thread property `topic`
//   setMuteChat            conversation property `alerts` = String(!mute)
//   leaveChat              thread property `lastleaveat`, then removes us
//   leaveChannel           private/shared channel: removes us from its roster
//   leaveTeam              the whole team, all its channels with it
//   toggleChannelVisibility  standard channel: conversation property
//                          `favorite` = String(shouldShow), Teams' "Hide"
//   editChannel            a channel's name (Teams' "Edit channel")
//   deleteChannel          the channel, for everyone in the team
//   createChannelV2        a new standard or private channel in a team
// Teams follows leaveChat with a hide; so do we (data/groups.ts). Standard
// channels can't be left on their own, only hidden; General can't be either,
// only left with its team. Whether we may rename or delete a channel is the
// channel's own canEdit / canDelete: Teams derives both from our team role
// and the team's settings (false for General's delete). Adding a channel is
// the team's canAddChannel, read alongside.

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

const CHANNEL_INFO = `query channelLeaveInfoQuery($channelId: ID!) {
  channelConversationById(channelId: $channelId) {
    __typename
    id
    channelType
    isGeneral
    canLeaveChannel
    canEdit
    canDelete
    displayName
    isHidden
    owningTeam { internalId groupId canLeave canAddChannel __typename }
  }
}`;

const LEAVE_CHANNEL = `mutation leaveChannelMutation($channelId: ID!, $teamId: ID!) {
  leaveChannel(channelId: $channelId, teamId: $teamId)
}`;

const LEAVE_TEAM = `mutation leaveTeamMutation($groupId: String, $teamThreadId: ID!) {
  leaveTeam(groupId: $groupId, teamThreadId: $teamThreadId) { errorCode userName __typename }
}`;

const CHANNEL_VISIBILITY = `mutation useToggleChannelVisibilityMutation($input: OneGQL_ToggleChannelVisibilityInput!) {
  toggleChannelVisibility(input: $input) {
    __typename
    ... on OneGQL_ChannelConversation { id isHidden __typename }
    ... on OneGQL_ToggleChannelVisibilityError { errorMessage channelRosterSizeExceeded }
  }
}`;

// A private channel goes through Teams' provisioning service and may answer
// with only its M365 group id (CreateK2ChannelResponse, threadId null); the
// thread then shows up in the local store shortly after.
const CREATE_CHANNEL = `mutation createChannelV2Mutation($team: CreateChannelTeamInputV2!, $channel: CreateChannelInputV2!) {
  createChannelV2(team: $team, channel: $channel) {
    __typename
    ... on Channel { id }
    ... on CreateK2ChannelResponse { id threadId }
    ... on CreateChannelConversationError { id errorMessage }
    ... on CreateChannelExpectedErrors { id errorType }
  }
}`;

const EDIT_CHANNEL = `mutation editChannelMutation($channelId: ID!, $details: EditChannelInput!) {
  editChannel(channelId: $channelId, details: $details) {
    __typename
    ... on EditChannelResult { id success }
    ... on EditChannelExpectedErrors { id errorType }
  }
}`;

const DELETE_CHANNEL = `mutation deleteChannelMutation($input: DeleteChannelInput!) {
  deleteChannel(input: $input) { id __typename }
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

/** What can be left or hidden for a channel, and its team. */
export interface ChannelInfo {
  channelType: string;
  isGeneral: boolean;
  canLeaveChannel: boolean;
  /** Team thread id (19:…@thread.tacv2) and its M365 group id. */
  teamId: string;
  groupId: string;
  canLeaveTeam: boolean;
  /** The team lets us add channels to it. */
  canAddChannel: boolean;
  canEdit: boolean;
  canDelete: boolean;
  displayName: string;
  isHidden: boolean;
}

export async function getChannelInfo(channelId: string): Promise<CdlRes<ChannelInfo>> {
  const r = await cdl<Data>("channelLeaveInfoQuery", CHANNEL_INFO, { channelId });
  if (!r.ok) return r;
  const ch = r.data.channelConversationById as Data | null;
  const team = (ch?.owningTeam ?? null) as Data | null;
  if (!ch || !team) return { ok: false, reason: "no channel info" };
  return {
    ok: true,
    data: {
      channelType: String(ch.channelType ?? ""),
      isGeneral: ch.isGeneral === true,
      canLeaveChannel: ch.canLeaveChannel === true,
      teamId: String(team.internalId ?? ""),
      groupId: String(team.groupId ?? ""),
      canLeaveTeam: team.canLeave === true,
      canAddChannel: team.canAddChannel === true,
      canEdit: ch.canEdit === true,
      canDelete: ch.canDelete === true,
      displayName: String(ch.displayName ?? ""),
      isHidden: ch.isHidden === true,
    },
  };
}

export async function leaveChannel(channelId: string, teamId: string): Promise<CdlRes<true>> {
  const r = await cdl<Data>("leaveChannelMutation", LEAVE_CHANNEL, { channelId, teamId });
  if (!r.ok) return r;
  return r.data.leaveChannel === true ? { ok: true, data: true } : { ok: false, reason: "leaveChannel refused" };
}

export async function leaveTeam(teamThreadId: string, groupId: string): Promise<CdlRes<true>> {
  const r = check<{ errorCode?: string | null }>(
    await cdl<Data>("leaveTeamMutation", LEAVE_TEAM, { groupId: groupId || null, teamThreadId }), "leaveTeam");
  if (!r.ok) return r;
  return r.data.errorCode ? { ok: false, reason: r.data.errorCode } : { ok: true, data: true };
}

/** Show or hide a standard channel in the channel list (Teams' "Hide"). */
export async function setChannelVisibility(channelId: string, show: boolean): Promise<CdlRes<true>> {
  return field(await cdl<Data>("useToggleChannelVisibilityMutation", CHANNEL_VISIBILITY, {
    input: { id: channelId, shouldShow: show, isJoinLeaveFlow: false },
  }), "toggleChannelVisibility");
}

/** Rename a channel (Teams' "Edit channel", name only). */
export async function renameChannel(channelId: string, displayName: string): Promise<CdlRes<true>> {
  const r = check<{ success?: boolean }>(await cdl<Data>("editChannelMutation", EDIT_CHANNEL, {
    channelId, details: { displayName },
  }), "editChannel", /Errors?$/);
  if (!r.ok) return r;
  return r.data.success === false ? { ok: false, reason: "editChannel refused" } : { ok: true, data: true };
}

/**
 * Delete a channel for the whole team. The worker reads the channel from its
 * store; the input's names and flags are its fallback when the store lacks it.
 */
export async function deleteChannel(channelId: string, i: ChannelInfo): Promise<CdlRes<true>> {
  const r = await cdl<Data>("deleteChannelMutation", DELETE_CHANNEL, {
    input: {
      id: channelId, displayName: i.displayName, isShown: !i.isHidden, isGeneral: i.isGeneral,
      hostTeamId: i.teamId || null, hostTeamGroupId: i.groupId || null,
    },
  });
  if (!r.ok) return r;
  return r.data.deleteChannel ? { ok: true, data: true } : { ok: false, reason: "deleteChannel refused" };
}

/**
 * Create a channel in a team (Teams' "Add channel"). Resolves to the new
 * channel's thread id, or "" when Teams didn't report it yet (private
 * channels: it arrives with the next sync).
 */
export async function createChannel(
  team: { teamId: string; groupId: string },
  channel: { displayName: string; description: string; isPrivate: boolean; threads: boolean },
): Promise<CdlRes<string>> {
  const r = check<{ __typename?: string; id?: string; threadId?: string | null; errorType?: string }>(
    await cdl<Data>("createChannelV2Mutation", CREATE_CHANNEL, {
      team: { teamThreadId: team.teamId, teamGroupId: team.groupId },
      channel: {
        displayName: channel.displayName,
        description: channel.description,
        channelType: channel.isPrivate ? "Private" : "Standard",
        // Teams' layout choice: threads (chat-like) or posts with replies.
        chatModality: channel.threads ? "Conversational" : "PostReply",
      },
    }, { timeoutMs: 60_000 }),
    "createChannelV2", /Error/,
  );
  if (!r.ok) return r;
  const d = r.data;
  if (d.__typename === "CreateK2ChannelResponse") return { ok: true, data: d.threadId || "" };
  return { ok: true, data: d.id || "" };
}
