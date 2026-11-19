// Shared domain types for the overlay. These describe the NORMALIZED shapes the
// data layer (teamsData) emits after narrowing Teams' untyped IndexedDB rows and
// chatsvc REST payloads. UI code consumes only these, never raw Teams data.

/** A Teams conversation kind, as surfaced in the sidebar sections. */
export type ChatKind = "chat" | "meeting" | "channel" | "notes";

/** Message importance flag carried on a Teams message. */
export type Importance = "normal" | "high" | "urgent";

/** One reaction bucket on a message (all users who used the same emotion). */
export interface Reaction {
  /** Emotion key, e.g. "like" / "heart", or a decoded glyph for custom ones. */
  key: string;
  /** Resolved emoji glyph for display (may equal `key`). */
  glyph: string;
  /** How many people reacted with this emotion. */
  count: number;
  /** True when the current user is among them. */
  mine: boolean;
}

/** A file/attachment reference extracted from a message. */
export interface FileRef {
  name: string;
  /** Download/open URL, or "" when Teams gave none. */
  url: string;
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
  team: string;
  isChannel: boolean;
  /** 1:1 partner MRI, set only for direct chats; "" otherwise. */
  avatarMri: string;
  /** MRIs of the other members (used for shared-chat lookups). */
  members: string[];
  favorite: boolean;
  pinned: boolean;
  /** Last-activity time, ms since epoch. */
  time: number;
  unread: boolean;
  last: LastMessage;
}

/** A normalized message ready to render. */
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
  /** Message time, ms since epoch. */
  time: number;
}

/** A person's profile card, as cached by Teams. Fields absent in cache are "". */
export interface Profile {
  displayName: string;
  imageUri: string;
  email: string;
  jobTitle: string;
  department: string;
  officeLocation: string;
}

/** A message being quote-replied to (composer chip + outgoing quote HTML). */
export interface Quote {
  id: string;
  from: string;
  text: string;
  fromMri: string;
  time: number;
}

/** Captured ic3 bearer and region for direct chatsvc calls. */
export interface Token {
  ic3: string;
  region: string;
  at: number;
}

/** Result of a write operation against Teams' backend. */
export type WriteResult = { ok: true; via?: string } | { ok: false; reason: string };
