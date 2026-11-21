// Read/write layer for Teams Calm.
//
// Teams v2 keeps every chat, message and profile in IndexedDB, synced live by
// its own background worker. We read that same local store directly — no auth
// tokens, no network, no decryption. This is the robust way to get exactly the
// data Teams renders: when Teams syncs, our data updates too.
//
// Stores used (database names contain ":<name>-manager:" or ":<name>:"):
//   conversation-manager  -> "conversations"            (chat/channel list + lastMessage)
//   replychain-manager    -> "replychains*"             (messages, inside messageMap)
//   profiles              -> "profiles"                 (mri -> displayName, imageUri)
//
// Schema notes (verified against a live client, Nov 2026):
// - Messages live in "replychains" AND/OR "replychains-2"; Teams migrates
//   between them and drops the old store on reload. Read every store whose name
//   starts with "replychains", by the [conversationId, …] index when present.
// - originalArrivalTime / latestDeliveryTime are epoch-ms NUMBERS, not strings.
// - Sender mri is message.creator ("8:orgid:<oid>").
// - Only chats Teams has opened at least once have messages cached locally.
//
// The implementation lives in ./data/ (one module per concern); this file is
// the public surface the UI imports. Keep the export list explicit: mock mode
// swaps this module for src/mock/teamsData.ts, and src/mock/parity.ts checks
// both export the same names.

export { CURRENT_OID, myMri } from "./data/idb";
export { profilePhotoUrl, loadProfiles, profile } from "./data/profiles";
export { listChats } from "./data/chats";
export { listMessages, fetchOlderRemote, primeRemote, resetPaging } from "./data/messages";
export { sendRemote, setReaction, deleteMessage, editMessage, undoDelete, removeFiles } from "./data/writes";
export { searchPeople, type PeopleHit } from "./data/people";
export { setChatHidden, markRead, markUnread } from "./data/readState";
export {
  renameChat,
  addChatMembers,
  removeChatMember,
  leaveChat,
  setChatMuted,
  getChannelNotifications,
  setChannelNotifications,
  type ChannelNotifications,
  type ChannelPreset,
  getChannelActions,
  leaveChannel,
  leaveTeam,
  deleteChannel,
  createChannel,
  type ChannelActions,
  type CreateResult,
  listChannelMembers,
  addChannelMembers,
  removeChannelMember,
  type ChannelMember,
} from "./data/groups";
