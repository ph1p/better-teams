// Chats through Teams' web worker (cdl.ts): message list paging, send, edit,
// delete, react, read/unread, hide, live events. Variables mirror what Teams' own UI sends (shapes from
// docs/cdl-catalog.json; id formats read from Teams' bundle, Nov 2026):
//   send/edit  queueId `queue_<convId>`, actionId `send_<clientMessageId>`
//   delete     queueId `queue_<convId>`, actionId `delete_msg_<messageId>`
//   reaction   queueId `reaction_<convId>_<messageId>`
//   read       queueId `consumptionhorizon_queue_<convId>`,
//              actionId `consumptionhorizon_<clientMessageId>`
// Chats only: channel posts carry reply-chain state this module does not model.

import { cdl, cdlSubscribe, check, type CdlRes } from "./cdl";
import * as D from "./chatDocs";

// Teams' MentionInput. `itemId` matches the span's itemid.
export interface MentionInput {
  itemId: string;
  userId: string;
  mentionType: string;
  displayName: string;
}

// What Teams keys read state and edits on.
export interface MsgRef {
  id: string;
  clientMessageId: string;
  /** originalArrivalTime, ms since epoch */
  time: number;
}

const uuid = (): string => crypto.randomUUID();
const iso = (ms: number) => new Date(ms).toISOString();

// 19 digits, as Teams' composer generates.
export function newClientMessageId() {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < 19) s += Math.floor(Math.random() * 10);
  return s;
}

export interface SendInput {
  convId: string;
  /** Message HTML as Teams' composer produces it (`<p>…</p>`, quote, mentions). */
  content: string;
  clientMessageId: string;
  mentions?: MentionInput[];
  /** Set to edit an existing message instead of creating one. */
  edit?: { id: string; time: number };
  /** Channel conversation: post through Teams' channel send pipeline. */
  channel?: boolean;
  /** Channel thread root id: reply in that thread instead of a new post. */
  replyChainId?: string;
  /** Forward these messages from `fromConvId` into `convId`; `content` is the optional comment. */
  forward?: { ids: string[]; fromConvId: string };
}

export async function sendMessage(i: SendInput): Promise<CdlRes<{ id: string; originalArrivalTime?: string }>> {
  const edit = !!i.edit;
  const message = {
    content: i.content,
    computed: {
      amsReferences: [],
      cards: [],
      embeddedLinks: [],
      isExpanded: false,
      offlineAssets: [],
      mentions: i.mentions || [],
      onBehalfOf: [],
      urlPreview: null,
      appIdsToInstall: [],
      blurHash: null,
    },
    files: [],
    deeplinks: [],
    clientMessageId: i.clientMessageId,
    title: "",
    replyChainId: i.replyChainId ?? null,
    ...(i.edit ? { id: i.edit.id } : {}),
    importance: "Standard",
    messageType: "RichText/Html",
    originalArrivalTime: i.edit ? iso(i.edit.time) : null,
    policyViolation: null,
    subject: "",
    meeting: null,
    scheduledSendTime: null,
    targetedMsgRecipientId: null,
    // The worker routes to postForwardMessageToConversation when both are set.
    forwardMessageIds: i.forward?.ids ?? [],
    forwardMessageOriginalConvId: i.forward?.fromConvId ?? null,
    forwardedMessageContext: null,
    forwardMessageRecipients: i.forward ? [i.convId] : [],
    forwardAppIdsToInstall: [],
    forwardMessageCardContents: i.forward ? {} : null,
    ...(i.forward ? { forwardMessageCardsCount: 0 } : {}),
    forwardPrivateReply: false,
    forwardTeamId: null,
    isForwardedMessage: false,
    draftCreationTime: null,
    postType: null,
    replyPermission: null,
    fluidUrlPermissionInfo: null,
    fluidProperties: null,
    crossPostChannels: [],
    crossPostId: null,
    sendPostAsEmail: null,
    shareToL1: null,
    sharedToMessageId: null,
    suggestedActions: null,
    from: null,
    originalSendPipelineTime: String(Date.now()),
    overrideImDisplayNameT1: null,
    meetingChatType: null,
    // Native compose: channel posts and replies use the "Channels" pipeline.
    sendPipelineThreadType: i.channel ? "Channels" : "Chats",
    isNewBotSession: false,
    inMeetingPrivateChatContext: null,
  };
  const r = await cdl<Record<string, unknown>>(
    "autoSendMessage",
    D.SEND,
    {
      enableDiverseEmotionsNonreactive: false,
      includeRepliesSummary: false,
      includeRepliesSummaryNonreactive: false,
      deferChatAppMetaDataFragment: false,
      action: edit ? "Update" : "Create",
      convId: i.convId,
      message,
      originalConvId: i.convId,
      correlationId: uuid(),
      searchSessionId: uuid(),
      sendFromChannel_ToBeRefactored: !!i.channel,
      offlineActionOptions: {
        queueId: `queue_${i.convId}`,
        actionId: `send_${i.clientMessageId}`,
        actionType: edit ? "edit" : "send",
        pendingUploadIds: [],
      },
      isBilateralChat: false,
    },
    { timeoutMs: 30_000 },
  );
  return check(r, "sendMessage");
}

export async function deleteMessage(
  convId: string,
  msg: { id: string; clientMessageId: string },
): Promise<CdlRes<true>> {
  const scenarioId = uuid();
  const r = await cdl<Record<string, unknown>>("ComponentsMessageAutoDeleteMutation", D.DELETE, {
    convId,
    messageId: msg.id,
    draftId: msg.id,
    isLie: false,
    replyChainId: null,
    clientMessageId: msg.clientMessageId || "",
    scenarioId,
    correlationId: scenarioId,
    offlineActionOptions: { actionId: `delete_msg_${msg.id}`, actionType: "delete", queueId: `queue_${convId}` },
    isTargetedMessage: false,
  });
  const c = check(r, "deleteMessage");
  return c.ok ? { ok: true, data: true } : c;
}

export async function setEmotion(convId: string, messageId: string, key: string, add: boolean): Promise<CdlRes<true>> {
  const r = await cdl<Record<string, unknown>>("ComponentsMessageSharedUpdateMessageEmotionMutation", D.EMOTION, {
    action: add ? "add" : "remove",
    convId,
    key,
    messageId,
    offlineActionOptions: {
      queueId: `reaction_${convId}_${messageId}`,
      actionType: add ? "REACTION_ADD" : "REACTION_REMOVE",
    },
  });
  const c = check(r, "updateMessageEmotion");
  return c.ok ? { ok: true, data: true } : c;
}

const chMessage = (m: MsgRef) => ({
  clientMessageId: m.clientMessageId || m.id,
  originalArrivalTime: iso(m.time),
});

async function setHorizon(convId: string, m: MsgRef, offline = true): Promise<CdlRes<true>> {
  const msg = chMessage(m);
  const vars: Record<string, unknown> = { convId, message: msg };
  if (offline) {
    vars.offlineActionOptions = {
      queueId: `consumptionhorizon_queue_${convId}`,
      actionId: `consumptionhorizon_${msg.clientMessageId}`,
    };
  }
  const r = await cdl<Record<string, unknown>>("ComponentsChatQueriesSetConsumptionHorizonMutation", D.SET_CH, vars);
  const c = check(r, "setConsumptionHorizon", /Error$/);
  return c.ok ? { ok: true, data: true } : c;
}

async function setBookmark(
  convId: string,
  message: { clientMessageId: string; originalArrivalTime: string },
): Promise<CdlRes<true>> {
  const r = await cdl<Record<string, unknown>>(
    "SimpleCollabChangeReadStatusMenuItemSetConversationConsumptionHorizonBookmarkMutation",
    D.SET_CH_BOOKMARK,
    { input: { convId, message } },
  );
  const c = check(r, "setConversationConsumptionHorizonBookmark", /Error$/);
  return c.ok ? { ok: true, data: true } : c;
}

// As Teams' "Mark as read": clear the unread bookmark ("0"/"0"), then move the
// consumption horizon to `last` (the chat's newest message).
export async function markRead(convId: string, last: MsgRef) {
  const b = await setBookmark(convId, { clientMessageId: "0", originalArrivalTime: "0" });
  if (!b.ok) return b;
  return setHorizon(convId, last);
}

// Channels: Teams sends the same mutation for the channel id, without the
// bookmark clear and without offlineActionOptions (catalog, 2026-11-19).
export function markChannelRead(convId: string, last: MsgRef) {
  return setHorizon(convId, last, false);
}

// As Teams' "Mark as unread": bookmark the chat's newest message.
export function markUnread(convId: string, last: MsgRef) {
  return setBookmark(convId, chMessage(last));
}

export interface MessagePage {
  /** Teams `Message` objects, NEWEST first (untyped: caller normalizes). */
  messages: unknown[];
  /** Cursor for the next older page; null once a page came back empty (start of history). */
  older: string | null;
  /** Worker's own `areMessagesAvailable` (false when it holds nothing for the chat). */
  available: boolean;
  /**
   * Worker's `isConvSynced`. False: the worker never loaded this chat and has
   * just started syncing it in the background (ask again shortly). True with
   * `available` false and no messages: the chat really has no messages.
   */
  synced: boolean;
}

// As Teams' chat pane: no cursor for the newest page, then
// `{cursor, direction:"BACKWARD"}` for each older page.
export async function listMessages(convId: string, cursor?: string): Promise<CdlRes<MessagePage>> {
  const r = await cdl<Record<string, unknown>>("ComponentsChatQueriesMessageListQuery", D.MESSAGE_LIST, {
    enableDiverseEmotionsNonreactive: false,
    includeRepliesSummary: false,
    includeRepliesSummaryNonreactive: false,
    deferChatAppMetaDataFragment: false,
    convId,
    replyChainId: null,
    ...(cursor ? { cursor: { value: cursor, source: "CHAT_MESSAGES" }, direction: "BACKWARD" } : {}),
  });
  const c = check<{
    messages?: unknown;
    cursor?: { value?: unknown } | null;
    areMessagesAvailable?: unknown;
    isConvSynced?: unknown;
  }>(r, "messages");
  if (!c.ok) return c;
  const messages = Array.isArray(c.data.messages) ? c.data.messages : [];
  // Teams' cursor value is the oldest message id on the page. The worker may
  // leave it null on a page served from memory although older history exists,
  // so derive it from that message; only an empty page ends the history.
  const v = c.data.cursor?.value;
  const oldest = messages.length ? String((messages[messages.length - 1] as { id?: unknown })?.id ?? "") : "";
  const next = typeof v === "string" && v ? v : oldest;
  const older = messages.length && next && next !== cursor ? next : null;
  return {
    ok: true,
    data: {
      messages,
      older,
      available: c.data.areMessagesAvailable === true,
      synced: c.data.isConvSynced === true,
    },
  };
}

/**
 * Hide or unhide a chat, as Teams' chat list menu: `useSetChatHiddenMutation`
 * with `{input:{convId, visible}}`. The worker stores the hide time as the
 * user property `unpinnedTime` (plus `historyHiddenTime`) and drops both on
 * unhide; the chat comes back by itself once a newer message arrives.
 */
export async function setChatHidden(convId: string, hidden: boolean): Promise<CdlRes<true>> {
  const r = await cdl<Record<string, unknown>>("useSetChatHiddenMutation", D.CHAT_HIDDEN, {
    input: { convId, visible: !hidden },
  });
  const c = check(r, "setChatHidden", /Error$/);
  return c.ok ? { ok: true, data: true } : c;
}

/**
 * Add a chat to Teams' Favorites folder (moves it out of any other user
 * folder), or take it out of its folder again. `folderId` is the Favorites
 * folder's id; the worker splits the global id on "|" and keeps the second part.
 */
export async function setChatFavorite(convId: string, fav: boolean, folderId: string): Promise<CdlRes<true>> {
  const r = fav
    ? await cdl<Record<string, unknown>>("MoveItemToConversationFolderMutation", D.MOVE_TO_FOLDER, {
        input: { conversationId: convId, toFolderId: `ConversationFolder|${folderId}` },
      })
    : await cdl<Record<string, unknown>>("RemoveConversationFromFolderMutation", D.REMOVE_FROM_FOLDER, {
        input: { conversationId: convId },
      });
  const c = check(r, fav ? "moveItemToConversationFolder" : "removeConversationFromFolder", /Error$/);
  return c.ok ? { ok: true, data: true } : c;
}

// Not in docs/cdl-catalog.json (Teams' chat-request pane wasn't recorded).
// Written from the worker's schema: contactAcceptOrBlockExtended(convId: ID!,
// inviterId: String, action: ContactAcceptOrBlockAction!, callerInfo: String!)
// -> BlockedContactUpdateExtended. Resolved by accept-block-chat-worker-resolver.
const ACCEPT_BLOCK =
  "mutation ContactAcceptOrBlockExtendedMutation($convId: ID!, $inviterId: String, $action: ContactAcceptOrBlockAction!, $callerInfo: String!) {\n  contactAcceptOrBlockExtended(convId: $convId, inviterId: $inviterId, action: $action, callerInfo: $callerInfo) {\n    id\n    userId\n    isBlocked\n    __typename\n  }\n}";

/**
 * Answer a chat request (someone outside your contacts wrote first), as
 * Teams' request pane: Accept moves it into the chat list, Block blocks the
 * inviter. On personal accounts the worker adds the inviter to the buddy group.
 */
export async function answerChatRequest(
  convId: string,
  inviterId: string,
  action: "Accept" | "Block",
): Promise<CdlRes<true>> {
  const r = await cdl<Record<string, unknown>>("ContactAcceptOrBlockExtendedMutation", ACCEPT_BLOCK, {
    convId,
    inviterId: inviterId || null,
    action,
    callerInfo: "better-teams",
  });
  const c = check(r, "contactAcceptOrBlockExtended");
  return c.ok ? { ok: true, data: true } : c;
}

export interface ChatEvent {
  /** Teams' event type: NewMessage, MessageUpdate, MessageRemoved, ThreadUpdate, ... */
  type: string;
  convId: string;
  messageId?: string;
}

/**
 * Live events for one chat, as Teams' chat pane subscribes them:
 * `DataResolversBrowserChatServiceEventsChatServiceBatchEventSubscription`
 * with the variables Teams' chat pane sends for a chat without reply chain
 * (read from Teams' bundle; `excludeMembersFromThreadUpdate` and
 * `useFullConversationSchema` are sent as `x || null` and were recorded as
 * booleans, so true). Each push is a batch (`chatServiceBatchEvent: [...]`).
 * Returns stop (sends GQL_STOP).
 */
export function watchChatEvents(convId: string, onEvents: (events: ChatEvent[]) => void) {
  return cdlSubscribe<{ chatServiceBatchEvent?: unknown }>(
    "DataResolversBrowserChatServiceEventsChatServiceBatchEventSubscription",
    D.CHAT_EVENTS,
    {
      includeRepliesSummary: true,
      enableDiverseEmotionsNonreactive: false,
      includeRepliesSummaryNonreactive: false,
      skipNavigationSubscription: false,
      includeBotStreamingRegulatorUpdates: false,
      includeSuggestedActions: false,
      deferChatAppMetaDataFragment: false,
      conversationId: convId,
      replyChainId: null,
      excludeMembersFromThreadUpdate: true,
      useFullConversationSchema: true,
    },
    (data) => {
      const raw = Array.isArray(data.chatServiceBatchEvent) ? data.chatServiceBatchEvent : [data.chatServiceBatchEvent];
      const events: ChatEvent[] = [];
      for (const e of raw as Array<Record<string, unknown> | null | undefined>) {
        if (!e || typeof e !== "object") continue;
        const conv = (e.conversation as { id?: unknown } | undefined)?.id;
        const msg = (e.message as { id?: unknown } | undefined)?.id ?? e.messageId;
        events.push({
          type: String(e.__typename || ""),
          convId: String(e.convId ?? conv ?? convId),
          ...(msg != null ? { messageId: String(msg) } : {}),
        });
      }
      if (events.length) onEvents(events);
    },
  );
}
