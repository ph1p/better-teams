import type { Card } from "./cards";
import type { MentionRef } from "./mentions";
// Shared domain types for the overlay. These describe the NORMALIZED shapes the
// data layer (teamsData) emits after narrowing Teams' untyped IndexedDB rows and
// chatsvc REST payloads. UI code consumes only these, never raw Teams data.

/** A Teams conversation kind, as surfaced in the sidebar sections. */
export type ChatKind = "chat" | "meeting" | "channel" | "notes";

/** Message importance flag carried on a Teams message. */
export type Importance = "normal" | "high" | "urgent";

/** One reaction bucket on a message (all users who used the same emotion). */
export interface Reaction {
  /** Emotion key, e.g. "like" / "heart" / "1f52d_telescope"; see glyphFor. */
  key: string;
  /** How many people reacted with this emotion. */
  count: number;
  /** True when the current user is among them. */
  mine: boolean;
}

/** A file/attachment reference extracted from a message. */
export interface FileRef {
  name: string;
  /** Open-in-browser URL (SharePoint), or "" when Teams gave none. */
  url: string;
  /** Lower-case file type, e.g. "pdf" or "png"; "" when unknown. */
  ext: string;
  /** Image preview Teams stored in AMS (/views/imgo, served with the page's cookies). */
  preview?: { url: string; width: number; height: number };
  /** SharePoint's own viewer page (Office, PDF, video, …), made to be framed. */
  embed?: string;
  /** SharePoint direct download. */
  download?: string;
  /** The message's raw properties.files entry, written back when another file is removed. */
  raw?: unknown;
}

/** The last-message preview shown on a chat row. */
export interface LastMessage {
  from: string;
  content: string;
  type: string;
}

/** A conversation row for the sidebar list. */
export interface Chat {
  id: string;
  kind: ChatKind;
  title: string;
  /** The title was built from member names (no topic), so the UI may re-format it. */
  nameTitle?: boolean;
  team: string;
  isChannel: boolean;
  /** 1:1 partner MRI, set only for direct chats; "" otherwise. */
  avatarMri: string;
  /** MRIs of the other members (used for shared-chat lookups). */
  members: string[];
  /** 1:1 chat with a Teams app/bot (Jira, Workflows, …): no calls, no presence. */
  app: boolean;
  favorite: boolean;
  pinned: boolean;
  /** Hidden from the chat list (Teams' "Hide"); search still finds it. */
  hidden: boolean;
  /** Channels: the team's thread id (General's own id). */
  teamId?: string;
  /** Channels: the team's General channel. */
  general?: boolean;
  /**
   * Channels: hidden in the team's channel list (Teams' channel "Hide"). Such a
   * channel leaves the sidebar (sections.ts listed), except General, which
   * Teams keeps listed (in italics).
   */
  channelHidden?: boolean;
  /** Notifications muted (Teams' "Mute"). Chats only; channels have presets. */
  muted: boolean;
  /** A group chat (not 1:1): can be renamed, has a roster you can change and leave. */
  group: boolean;
  /** We left this conversation (or were removed). */
  left: boolean;
  /** Last-activity time, ms since epoch. */
  time: number;
  unread: boolean;
  last: LastMessage;
  /** A chat request: someone outside your contacts wrote first; accept or block it. */
  request?: boolean;
  /** MRI of who started the chat (the request's inviter). */
  inviter?: string;
  /** Root message id of a call running in this conversation right now, if any. */
  liveCall?: string;
}

/** A normalized message ready to render. */
export interface ForwardRef {
  senderMri: string;
  /** Original sender's display name ("" when unknown). */
  sender: string;
  /** Original send time, ms. */
  time: number;
  /** Original message id and its conversation (chat or channel thread id). */
  messageId: string;
  threadId: string;
}

export interface Message {
  id: string;
  /** Thread root id (channels); equals `id` for top-level posts. */
  rootId: string;
  /** Root post time, ms (used to order channel threads). */
  rootTime: number;
  isReply: boolean;
  from: string;
  fromMri: string;
  /** Message HTML content (Teams markup) or plain text. */
  content: string;
  messageType: string;
  mine: boolean;
  deleted: boolean;
  edited: boolean;
  subject: string;
  importance: Importance;
  reactions: Reaction[];
  files: FileRef[];
  /** Bot / connector cards (Adaptive, hero, O365 connector), see cards.ts. */
  cards?: Card[];
  /** @mentions in `content` (absent when none), matched to its spans by itemid. */
  mentions?: MentionRef[];
  /** Message time, ms since epoch. */
  time: number;
  /** Forwarded message: where the original came from (its body is the Forward blockquote in `content`). */
  forwarded?: ForwardRef;
  /** Channel meeting event: the thread root ("start") or its end marker. */
  call?: "start" | "end";
}

/** A person's profile card, as cached by Teams. Fields absent in cache are "". */
export interface Profile {
  displayName: string;
  imageUri: string;
  email: string;
  jobTitle: string;
  department: string;
  officeLocation: string;
  /** Publisher of a Teams app (bot profiles only), e.g. "Atlassian.com". */
  developer?: string;
  /** Directory given name / surname, when Teams' profile store has them. */
  givenName?: string;
  surname?: string;
}

/** A message being quote-replied to (composer chip + outgoing quote HTML). */
export interface Quote {
  id: string;
  from: string;
  text: string;
  fromMri: string;
  time: number;
}

/** Result of a write operation against Teams' backend. */
export type WriteResult = { ok: true; via?: string } | { ok: false; reason: string };

/** What an activity-feed item reports: Teams' activityType, narrowed to the kinds the UI labels. */
export type ActivityKind = "mention" | "reaction" | "reply" | "other";

/** One item of Teams' activity feed (the "48:notifications" stream). */
export interface Activity {
  id: string;
  kind: ActivityKind;
  /** Teams' raw activityType, kept for "other" items. */
  type: string;
  /** Reaction key for reactions ("like", "heart"…), else "". */
  subtype: string;
  /** Activity time, ms since epoch. */
  time: number;
  /** Conversation the activity happened in. */
  threadId: string;
  /** Message the activity points at, "" when none. */
  messageId: string;
  actorMri: string;
  actorName: string;
  /** Plain-text preview of the source message. */
  preview: string;
  /** How many actions this item folds together (e.g. 3 reactions). */
  count: number;
  unread: boolean;
}
