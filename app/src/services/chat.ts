// Chats through Teams' web worker (cdl.ts): message list paging, send, edit,
// delete, react, read/unread, hide, live events. Variables mirror what Teams' own UI sends (shapes from
// docs/cdl-catalog.json; id formats read from Teams' bundle, Nov 2026):
//   send/edit  queueId `queue_<convId>`, actionId `send_<clientMessageId>`
//   delete     queueId `queue_<convId>`, actionId `delete_msg_<messageId>`
//   reaction   queueId `reaction_<convId>_<messageId>`
//   read       queueId `consumptionhorizon_queue_<convId>`,
//              actionId `consumptionhorizon_<clientMessageId>`
// Chats only: channel posts carry reply-chain state this module does not model.

import { cdl, cdlSubscribe, type CdlRes } from "./cdl";
import * as D from "./chatDocs";

/** One @mention, as Teams' MentionInput. `itemId` matches the span's itemid. */
export interface MentionInput {
  itemId: string;
  userId: string;
  mentionType: string;
  displayName: string;
}

/** A message reference: what Teams keys read state and edits on. */
export interface MsgRef {
  id: string;
  clientMessageId: string;
  /** originalArrivalTime, ms since epoch */
  time: number;
}

const uuid = (): string => crypto.randomUUID();
const iso = (ms: number): string => new Date(ms).toISOString();

/** 19-digit client message id, as Teams' composer generates. */
export function newClientMessageId(): string {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < 19) s += Math.floor(Math.random() * 10);
  return s;
}

function check<T>(r: CdlRes<Record<string, unknown>>, field: string, bad?: RegExp): CdlRes<T> {
  if (!r.ok) return r;
  const v = r.data[field] as { __typename?: string; errorCode?: string; errorMessage?: string } | null | undefined;
  if (!v) return { ok: false, reason: `no ${field}` };
  if (bad && v.__typename && bad.test(v.__typename)) {
    return { ok: false, reason: `${v.__typename}${v.errorCode ? ": " + v.errorCode : ""}${v.errorMessage ? " " + v.errorMessage : ""}` };
  }
  return { ok: true, data: v as T };
}

export interface SendInput {
  convId: string;
  /** Message HTML as Teams' composer produces it (`<p>…</p>`, quote, mentions). */
  content: string;
  clientMessageId: string;
  mentions?: MentionInput[];
  /** Set to edit an existing message instead of creating one. */
  edit?: { id: string; time: number };
}

/** Send (or edit) a message: Teams' `autoSendMessage`, action Create/Update. */
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
    replyChainId: null,
    ...(i.edit ? { id: i.edit.id } : {}),
    importance: "Standard",
    messageType: "RichText/Html",
    originalArrivalTime: i.edit ? iso(i.edit.time) : null,
    policyViolation: null,
    subject: "",
    meeting: null,
    scheduledSendTime: null,
    targetedMsgRecipientId: null,
    forwardMessageIds: [],
    forwardMessageOriginalConvId: null,
    forwardedMessageContext: null,
    forwardMessageRecipients: [],
    forwardAppIdsToInstall: [],
    forwardMessageCardContents: null,
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
    sendPipelineThreadType: "Chats",
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
      sendFromChannel_ToBeRefactored: false,
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

/** Delete one of my messages: Teams' `ComponentsMessageAutoDeleteMutation`. */
export async function deleteMessage(convId: string, msg: { id: string; clientMessageId: string }): Promise<CdlRes<true>> {
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

/** Add or remove my reaction: Teams' `ComponentsMessageSharedUpdateMessageEmotionMutation`. */
export async function setEmotion(convId: string, messageId: string, key: string, add: boolean): Promise<CdlRes<true>> {
  const r = await cdl<Record<string, unknown>>("ComponentsMessageSharedUpdateMessageEmotionMutation", D.EMOTION, {
    action: add ? "add" : "remove",
    convId,
    key,
    messageId,
    offlineActionOptions: { queueId: `reaction_${convId}_${messageId}`, actionType: add ? "REACTION_ADD" : "REACTION_REMOVE" },
  });
  const c = check(r, "updateMessageEmotion");
  return c.ok ? { ok: true, data: true } : c;
}

const chMessage = (m: MsgRef): { clientMessageId: string; originalArrivalTime: string } => ({
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

async function setBookmark(convId: string, message: { clientMessageId: string; originalArrivalTime: string }): Promise<CdlRes<true>> {
  const r = await cdl<Record<string, unknown>>(
    "SimpleCollabChangeReadStatusMenuItemSetConversationConsumptionHorizonBookmarkMutation",
    D.SET_CH_BOOKMARK,
    { input: { convId, message } },
  );
  const c = check(r, "setConversationConsumptionHorizonBookmark", /Error$/);
  return c.ok ? { ok: true, data: true } : c;
}

/**
 * Mark a chat read up to `last` (its newest message), as Teams' "Mark as read":
 * clear the unread bookmark ("0"/"0"), then move the consumption horizon.
 */
export async function markRead(convId: string, last: MsgRef): Promise<CdlRes<true>> {
  const b = await setBookmark(convId, { clientMessageId: "0", originalArrivalTime: "0" });
  if (!b.ok) return b;
  return setHorizon(convId, last);
}

/** Mark a chat unread, as Teams' "Mark as unread": bookmark its newest message. */
// Channels: Teams sends the same mutation for the channel id, without the
// bookmark clear and without offlineActionOptions (catalog, 2026-11-19).
export function markChannelRead(convId: string, last: MsgRef): Promise<CdlRes<true>> {
  return setHorizon(convId, last, false);
}

export function markUnread(convId: string, last: MsgRef): Promise<CdlRes<true>> {
  return setBookmark(convId, chMessage(last));
}

/** One page of a chat's timeline, as the worker returns it. */
export interface MessagePage {
  /** Teams `Message` objects, NEWEST first (untyped: caller normalizes). */
  messages: unknown[];
  /** Cursor for the next older page; null once a page came back empty (start of history). */
  older: string | null;
  /** Worker's own `areMessagesAvailable` (false when it holds nothing for the chat). */
  available: boolean;
}

/**
 * Read a chat's messages as Teams' chat pane does: `ComponentsChatQueriesMessageListQuery`
 * without a cursor for the newest page, then with `{cursor, direction:"BACKWARD"}`
 * for each older page. The cursor value is the oldest message id on a page; an
 * empty page ends the history.
 */
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
  const c = check<{ messages?: unknown; cursor?: { value?: unknown } | null; areMessagesAvailable?: unknown }>(r, "messages");
  if (!c.ok) return c;
  const messages = Array.isArray(c.data.messages) ? c.data.messages : [];
  // Teams' cursor value is the oldest message id on the page. The worker may
  // leave it null on a page served from memory although older history exists,
  // so derive it from that message; only an empty page ends the history.
  const v = c.data.cursor?.value;
  const oldest = messages.length ? String((messages[messages.length - 1] as { id?: unknown })?.id ?? "") : "";
  const next = typeof v === "string" && v ? v : oldest;
  const older = messages.length && next && next !== cursor ? next : null;
  return { ok: true, data: { messages, older, available: c.data.areMessagesAvailable === true } };
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

/** One live event for a chat, reduced to what the overlay acts on. */
export interface ChatEvent {
  /** Teams' event type: NewMessage, MessageUpdate, MessageRemoved, ThreadUpdate, ... */
  type: string;
  convId: string;
  /** Message id for message events. */
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
export function watchChatEvents(convId: string, onEvents: (events: ChatEvent[]) => void): () => void {
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
