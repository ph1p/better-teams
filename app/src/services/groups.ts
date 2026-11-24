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
//   threadMembersByRole    a team's or private channel's roster
//   addBulkMembersToTeam / addBulkMembersToPrivateChannel  add people
//   removeThreadMembership remove one person from a team or private channel
// Teams follows leaveChat with a hide; so do we (data/groups.ts). Standard
// channels can't be left on their own, only hidden; General can't be either,
// only left with its team. Whether we may rename or delete a channel is the
// channel's own canEdit / canDelete: Teams derives both from our team role
// and the team's settings (false for General's delete). Adding a channel is
// the team's canAddChannel, read alongside. Standard channels share their
// team's roster; a private channel has its own (its people must be in the
// team). Teams lets owners (memberRole ADMIN) add and remove people; a private
// channel's canAddMembers says whether we may add to it.

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
    canAddMembers
    memberRole
    owningTeam { internalId groupId canLeave canAddChannel canAddMember memberRole __typename }
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

// Teams' own members-tab query (docs/cdl-catalog.json), trimmed to what we show.
const MEMBERS = `query ComponentsThreadMembersTableGetMembersQuery($threadId: ID!, $roles: [TeamMemberRole!]!, $nextLink: String, $orderBy: [ThreadMemberOrderByInput!]) {
  threadMembersByRole(threadId: $threadId, roles: $roles, nextLink: $nextLink, orderBy: $orderBy) {
    id
    members { __typename user { id displayName jobTitle tenantId objectId __typename } role }
    totalCount
    nextLink
    error
    __typename
  }
}`;

const UPDATED_MEMBERS = `members { user { id __typename } role __typename } erroredMembers { id error __typename } __typename`;

const ADD_TEAM_MEMBERS = `mutation addBulkMembersToTeamMutation($teamId: ID!, $groupId: ID!, $users: [UserCompactInput!]!) {
  addBulkMembersToTeam(teamId: $teamId, groupId: $groupId, users: $users, allowAsyncAddition: false) { ${UPDATED_MEMBERS} }
}`;

const ADD_CHANNEL_MEMBERS = `mutation addBulkMembersToPrivateChannelMutation($teamId: ID!, $channelId: ID!, $users: [UserCompactInput!]!) {
  addBulkMembersToPrivateChannel(teamId: $teamId, channelId: $channelId, users: $users) { ${UPDATED_MEMBERS} }
}`;

const REMOVE_THREAD_MEMBER = `mutation removeThreadMembershipMutation($threadId: ID!, $groupId: String, $userMri: String, $objectId: String, $userTenantId: String) {
  removeThreadMembership(threadId: $threadId, groupId: $groupId, userMri: $userMri, objectId: $objectId, userTenantId: $userTenantId)
}`;

type Data = Record<string, unknown>;

// Fails with the error type's name when the field is an *Error union member.
function field(r: CdlRes<Data>, name: string): CdlRes<true> {
  const c = check(r, name, /Error$/);
  return c.ok ? { ok: true, data: true } : c;
}

export async function setConversationTitle(convId: string, title: string) {
  return field(
    await cdl<Data>("ComponentsChatTitleUpdaterSetConversationTitleMutation", RENAME, { convId, title }),
    "setConversationTitle",
  );
}

// `shareHistoryDays`: -1 none, 0 all, N the last N days (Teams' own encoding;
// the worker turns N into a time).
export async function addMembers(convId: string, mris: string[], shareHistoryDays = 0) {
  return field(
    await cdl<Data>("ComponentsChatAddMembersAddMembersToConversationMutation", ADD_MEMBERS, {
      convId,
      members: mris.map((id) => ({ id })),
      shareHistoryTime: shareHistoryDays,
    }),
    "addMembersToConversation",
  );
}

export async function removeMember(convId: string, mri: string) {
  return field(
    await cdl<Data>("ComponentsChatRosterRemoveMemberFromConversationMutation", REMOVE_MEMBER, {
      convId,
      userToRemove: mri,
    }),
    "removeMemberFromConversation",
  );
}

export async function leaveChat(convId: string) {
  return field(await cdl<Data>("ComponentsChatOptionsSharedLeaveChatMutation", LEAVE, { convId }), "leaveChat");
}

export async function setMuteChat(convId: string, mute: boolean) {
  return field(
    await cdl<Data>("ComponentsChatOptionsSharedSetMuteChatMutation", MUTE, { convId, mute }),
    "setMuteChat",
  );
}

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
  const ch = r.data.channelConversationById as {
    notificationAndFollowSettings?: { channelGranularSetting?: Data };
  } | null;
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

export async function setChannelNotifications(
  convId: string,
  preset: ChannelPreset,
  keep?: Pick<ChannelNotifications, "tagMentions" | "channelTeamMentions">,
) {
  return field(
    await cdl<Data>("channelGranularSettingsMutation", CHANNEL_NOTIF_SET, {
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
    }),
    "setFollowNotificationSettings",
  );
}

export interface ChannelInfo {
  channelType: string;
  isGeneral: boolean;
  canLeaveChannel: boolean;
  // Team thread id (19:…@thread.tacv2) and its M365 group id.
  teamId: string;
  groupId: string;
  canLeaveTeam: boolean;
  canAddChannel: boolean;
  canEdit: boolean;
  canDelete: boolean;
  displayName: string;
  isHidden: boolean;
  // Teams' memberRole for us in the channel and its team: "ADMIN" for owners.
  channelRole: string;
  teamRole: string;
  canAddMembers: boolean;
  canAddTeamMember: boolean;
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
      channelRole: String(ch.memberRole ?? ""),
      teamRole: String(team.memberRole ?? ""),
      canAddMembers: ch.canAddMembers === true,
      canAddTeamMember: team.canAddMember === true,
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
    await cdl<Data>("leaveTeamMutation", LEAVE_TEAM, { groupId: groupId || null, teamThreadId }),
    "leaveTeam",
  );
  if (!r.ok) return r;
  return r.data.errorCode ? { ok: false, reason: r.data.errorCode } : { ok: true, data: true };
}

export async function setChannelVisibility(channelId: string, show: boolean) {
  return field(
    await cdl<Data>("useToggleChannelVisibilityMutation", CHANNEL_VISIBILITY, {
      input: { id: channelId, shouldShow: show, isJoinLeaveFlow: false },
    }),
    "toggleChannelVisibility",
  );
}

// Every channel of a team, hidden ones included, as Teams' own channel
// management lists them. isShownByDefault is the team owner's "Recommended"
// (shown to members by default); isShown is this user's own choice.
const TEAM_CHANNELS = `query ComponentsCreateChannelGetTeamQuery($teamThreadId: ID!, $activitiesFromWorker: Boolean!) {
  team(teamThreadId: $teamThreadId, activitiesFromWorker: $activitiesFromWorker) {
    id
    channels { id displayName isGeneral isShownByDefault isShown isDeleted }
  }
}`;

export interface TeamChannelInfo {
  id: string;
  displayName: string;
  isGeneral: boolean;
  isShownByDefault: boolean;
  isShown: boolean;
}

export async function getTeamChannels(teamThreadId: string): Promise<CdlRes<TeamChannelInfo[]>> {
  const r = await cdl<{ team?: { channels?: (TeamChannelInfo & { isDeleted?: boolean })[] } | null }>(
    "ComponentsCreateChannelGetTeamQuery",
    TEAM_CHANNELS,
    { teamThreadId, activitiesFromWorker: false },
  );
  if (!r.ok) return r;
  const list = r.data.team?.channels;
  if (!Array.isArray(list)) return { ok: false, reason: "no team" };
  return { ok: true, data: list.filter((c) => c && c.id && !c.isDeleted) };
}

export async function renameChannel(channelId: string, displayName: string): Promise<CdlRes<true>> {
  const r = check<{ success?: boolean }>(
    await cdl<Data>("editChannelMutation", EDIT_CHANNEL, {
      channelId,
      details: { displayName },
    }),
    "editChannel",
    /Errors?$/,
  );
  if (!r.ok) return r;
  return r.data.success === false ? { ok: false, reason: "editChannel refused" } : { ok: true, data: true };
}

// The worker reads the channel from its store; the input's names and flags
// are its fallback when the store lacks it.
export async function deleteChannel(channelId: string, i: ChannelInfo): Promise<CdlRes<true>> {
  const r = await cdl<Data>("deleteChannelMutation", DELETE_CHANNEL, {
    input: {
      id: channelId,
      displayName: i.displayName,
      isShown: !i.isHidden,
      isGeneral: i.isGeneral,
      hostTeamId: i.teamId || null,
      hostTeamGroupId: i.groupId || null,
    },
  });
  if (!r.ok) return r;
  return r.data.deleteChannel ? { ok: true, data: true } : { ok: false, reason: "deleteChannel refused" };
}

// Resolves to the new channel's thread id, or "" when Teams didn't report it
// yet (private channels: it arrives with the next sync).
export async function createChannel(
  team: { teamId: string; groupId: string },
  channel: { displayName: string; description: string; isPrivate: boolean; threads: boolean },
): Promise<CdlRes<string>> {
  const r = check<{ __typename?: string; id?: string; threadId?: string | null; errorType?: string }>(
    await cdl<Data>(
      "createChannelV2Mutation",
      CREATE_CHANNEL,
      {
        team: { teamThreadId: team.teamId, teamGroupId: team.groupId },
        channel: {
          displayName: channel.displayName,
          description: channel.description,
          channelType: channel.isPrivate ? "Private" : "Standard",
          // Teams' layout choice: threads (chat-like) or posts with replies.
          chatModality: channel.threads ? "Conversational" : "PostReply",
        },
      },
      { timeoutMs: 60_000 },
    ),
    "createChannelV2",
    /Error/,
  );
  if (!r.ok) return r;
  const d = r.data;
  if (d.__typename === "CreateK2ChannelResponse") return { ok: true, data: d.threadId || "" };
  return { ok: true, data: d.id || "" };
}

export interface ThreadMember {
  mri: string;
  displayName: string;
  jobTitle: string;
  // Teams' TeamMemberRole: "Admin" (owner), "User", "Guest".
  role: string;
  objectId: string;
  tenantId: string;
}

// Owners first, in Teams' order.
export async function listThreadMembers(threadId: string): Promise<CdlRes<ThreadMember[]>> {
  const out: ThreadMember[] = [];
  let nextLink: string | null = null;
  // Teams pages by 100; a few pages cover any team we'd show in a panel.
  for (let page = 0; page < 10; page++) {
    const r: CdlRes<{ members?: Data[]; nextLink?: string | null; error?: string | null }> = check(
      await cdl<Data>(
        "ComponentsThreadMembersTableGetMembersQuery",
        MEMBERS,
        {
          threadId,
          roles: ["Admin", "User", "Guest"],
          nextLink,
        },
        { timeoutMs: 30_000 },
      ),
      "threadMembersByRole",
    );
    if (!r.ok) return r;
    if (r.data.error) return { ok: false, reason: r.data.error };
    for (const m of r.data.members ?? []) {
      const u = (m.user ?? {}) as Data;
      out.push({
        mri: String(u.id ?? ""),
        displayName: String(u.displayName ?? ""),
        jobTitle: String(u.jobTitle ?? ""),
        role: String(m.role ?? ""),
        objectId: String(u.objectId ?? ""),
        tenantId: String(u.tenantId ?? ""),
      });
    }
    nextLink = r.data.nextLink || null;
    if (!nextLink) break;
  }
  return { ok: true, data: out };
}

// Empty when all went in.
export type AddFailures = { mri: string; error: string }[];

// With `channelId`: a private channel; its people must already be in the team.
export async function addThreadMembers(
  team: { teamId: string; groupId: string },
  channelId: string | null,
  mris: string[],
): Promise<CdlRes<AddFailures>> {
  const users = mris.map((userMri) => ({ userMri, role: "User" }));
  const name = channelId ? "addBulkMembersToPrivateChannel" : "addBulkMembersToTeam";
  const r = check<{ erroredMembers?: Data[] }>(
    channelId
      ? await cdl<Data>(
          "addBulkMembersToPrivateChannelMutation",
          ADD_CHANNEL_MEMBERS,
          { teamId: team.teamId, channelId, users },
          { timeoutMs: 60_000 },
        )
      : await cdl<Data>(
          "addBulkMembersToTeamMutation",
          ADD_TEAM_MEMBERS,
          { teamId: team.teamId, groupId: team.groupId, users },
          { timeoutMs: 60_000 },
        ),
    name,
  );
  if (!r.ok) return r;
  return {
    ok: true,
    data: (r.data.erroredMembers ?? [])
      .filter(Boolean)
      .map((e) => ({ mri: String(e.id ?? ""), error: String(e.error ?? "") })),
  };
}

// `threadId` is the team's thread (with `groupId` its M365 group) or the
// private channel. The worker picks the service from the thread's type.
export async function removeThreadMember(
  threadId: string,
  groupId: string | null,
  m: ThreadMember,
): Promise<CdlRes<true>> {
  const r = await cdl<Data>(
    "removeThreadMembershipMutation",
    REMOVE_THREAD_MEMBER,
    {
      threadId,
      groupId,
      userMri: m.mri,
      objectId: m.objectId || null,
      userTenantId: m.tenantId || null,
    },
    { timeoutMs: 30_000 },
  );
  if (!r.ok) return r;
  return r.data.removeThreadMembership === true
    ? { ok: true, data: true }
    : { ok: false, reason: "removeThreadMembership refused" };
}
