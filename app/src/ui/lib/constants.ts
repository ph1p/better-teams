// How often the chat list and the open conversation poll IndexedDB.
export const POLL_MS = 4000;
// Messages from the same sender within this window group into one bubble cluster.
export const GROUP_GAP_MS = 5 * 60 * 1000;
// Remote (uncached) chats load a small first page; scroll-up pages older history.
export const INITIAL_REMOTE = 30;
// Sidebar sections always show at least this many rows, then only the ones
// active within RECENT_MS (up to SECTION_CAP); the rest sit behind "Show more".
// Unread rows and the open chat always show.
export const SECTION_MIN = 5;
export const SECTION_CAP = 12;
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
// Most people a group call deep link rings; bigger chats get no call button.
export const MAX_CALL = 20;
/** A channel meeting without an end event counts as live this long after it started. */
export const LIVE_CALL_MS = 12 * 60 * 60 * 1000;
