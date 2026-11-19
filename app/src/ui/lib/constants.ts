// Shared timing/sizing constants for the overlay UI.

// How often the chat list and the open conversation poll IndexedDB.
export const POLL_MS = 4000;
// Messages from the same sender within this window group into one bubble cluster.
export const GROUP_GAP_MS = 5 * 60 * 1000;
// Remote (uncached) chats load a small first page; scroll-up pages older history.
export const INITIAL_REMOTE = 30;
// Sidebar sections show this many rows before "Show more".
export const SECTION_CAP = 10;
