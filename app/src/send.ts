// Send layer for Better Teams.
//
// We deliberately do NOT replay Teams' undocumented internal POST endpoints
// (they change and need the live auth token). Instead we drive Teams' own
// composer: navigate the native client to the target conversation, type into
// its contenteditable, and trigger its real send. This reuses Teams' entire
// authenticated send pipeline, so it keeps working across Teams updates.
//
// Safety: before typing we check that the native composer belongs to the
// target conversation (the send button carries data-track-thread-id). If it
// does not, we abort instead of risking a message to the wrong person.

import type { WriteResult } from "./types";
import { formatMessage } from "./markdown";
import { isChannelId } from "./data/state";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const SEND_BUTTON = '[data-tid="sendMessageCommands-send"], [data-tid="newMessageCommands-send"], button[name="send"]';

// Thread id the native composer currently targets, or "" if unknown.
export function nativeThreadId(): string {
  const b = document.querySelector("button[data-track-thread-id]");
  return (b && b.getAttribute("data-track-thread-id")) || "";
}

// The overlay itself switches Teams' chat (sends, calls, new chats). While it
// does, and for a moment after, a native chat change is ours, not the user's
// (a notification click, a click in Teams), so it must not be followed.
let driving = 0;
let drivenAt = 0;
async function drive<T>(fn: () => Promise<T>): Promise<T> {
  driving++;
  try {
    return await fn();
  } finally {
    driving--;
    drivenAt = Date.now();
  }
}

/** True while (or just after) the overlay drives Teams' native chat. */
export function nativeDriven(): boolean {
  return driving > 0 || Date.now() - drivenAt < 2000;
}

async function waitFor<T>(fn: () => T, ms = 2500, step = 100): Promise<T> {
  for (let t = 0; t < ms; t += step) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return fn();
}

// Open a conversation in the underlying native client by clicking its sidebar
// row. The native list is virtualized (collapsed folders render no rows), so
// this only works for rows Teams currently renders — favorites and expanded
// folders. Rows carry the conversation id in data-fui-tree-item-value.
// Channels pass their team name: a collapsed team is expanded first.
export function openNativeChat(conversationId: string, title?: string, team?: string): Promise<boolean> {
  return drive(() => clickNativeChat(conversationId, title, team));
}

/** Every element matching `sel` in Teams' own DOM (not inside the overlay). */
const nativeAll = (sel: string): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>(sel)].filter((x) => !x.closest("#tc-root"));

const firstLine = (el: HTMLElement): string => (el.innerText || "").trim().split("\n")[0].trim();

function findNativeRow(conversationId: string, title?: string, team?: string): HTMLElement | undefined {
  const rows = nativeAll('[role="treeitem"]');
  const byId =
    rows.find((r) => (r.getAttribute("data-fui-tree-item-value") || "").includes(conversationId)) ||
    rows.find((r) => (r.outerHTML || "").includes(conversationId));
  if (byId) return byId;
  // The title is a last resort and only when it names one row: every team has
  // a "General", and clicking another team's switched native Teams there. With
  // a team name we only look at rows nested under that team's row.
  if (!title) return undefined;
  // innerText forces layout: read each team row's label once, not per child.
  const label = new Map<HTMLElement, string>();
  const scope = team
    ? rows.filter((r) => {
        const parent = r.parentElement?.closest<HTMLElement>('[role="treeitem"]');
        if (!parent) return false;
        if (!label.has(parent)) label.set(parent, firstLine(parent));
        return label.get(parent) === team.trim();
      })
    : rows;
  const byTitle = scope.filter((r) => firstLine(r) === title.trim());
  return byTitle.length === 1 ? byTitle[0] : undefined;
}

// A channel row is only rendered while its team is expanded. Expand the team
// row (matched by name) so the channel rows below it render.
async function expandNativeTeam(team: string): Promise<boolean> {
  const head = nativeAll('[role="treeitem"][aria-expanded="false"]').find((r) => firstLine(r) === team.trim());
  if (!head) return false;
  head.scrollIntoView({ block: "center" });
  head.click();
  return !!(await waitFor(() => head.getAttribute("aria-expanded") === "true", 1500));
}

async function clickNativeChat(conversationId: string, title?: string, team?: string): Promise<boolean> {
  if (nativeThreadId() === conversationId) return true;
  let row = findNativeRow(conversationId, title, team);
  if (!row && team && (await expandNativeTeam(team))) {
    row = await waitFor(() => findNativeRow(conversationId, title, team), 1500);
  }
  if (!row) return false;
  row.scrollIntoView({ block: "center" });
  row.click();
  return !!(await waitFor(() => nativeThreadId() === conversationId));
}

// Teams' own chat-header call buttons (data-tids from the Teams bundle). The
// header shows one kind as a direct button (which one varies by layout/width);
// both kinds always sit in the "more call options" dropdown next to it.
const CALL_DIRECT = {
  audio: '[data-tid="default-chat-call-audio-button"], [data-tid="dropdown-audio-call-primary-btn"]',
  video: '[data-tid="default-chat-call-video-button"]',
};
const CALL_MENU_TOGGLE = '[data-tid="dropdown-calling-toggle-more-options-btn"]';
const CALL_MENU_ITEM = {
  audio: '[data-tid="chat-call-audio-button"], [data-tid="dropdown-audio-call-btn"]',
  video: '[data-tid="chat-call-video-button"], [data-tid="dropdown-video-call-btn"]',
};

function nativeButton(sel: string): HTMLElement | null {
  return nativeAll(sel)[0] ?? null;
}

/**
 * Start an audio/video call exactly as the stock UI does: open the chat in the
 * native client, then click Teams' own call button in its header. Teams then
 * runs its whole calling flow (intent, ringing, call window) itself.
 */
export async function startNativeCall(
  conversationId: string,
  title: string,
  kind: "audio" | "video",
): Promise<WriteResult> {
  if (!(await openNativeChat(conversationId, title))) return { ok: false, reason: "chat not open in Teams" };
  // Wait for the header to render, then use the direct button or the dropdown.
  await waitFor(() => nativeButton(CALL_DIRECT[kind]) || nativeButton(CALL_MENU_TOGGLE));
  let btn = nativeButton(CALL_DIRECT[kind]);
  if (!btn) {
    const toggle = nativeButton(CALL_MENU_TOGGLE);
    if (toggle) {
      toggle.click();
      btn = await waitFor(() => nativeButton(CALL_MENU_ITEM[kind]));
    }
  }
  if (!btn) return { ok: false, reason: "no call button in Teams" };
  if (btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true") {
    return { ok: false, reason: "Teams has calling disabled for this chat" };
  }
  // Re-check the target right before clicking: never call the wrong chat.
  if (nativeThreadId() !== conversationId) return { ok: false, reason: "Teams switched chats" };
  btn.click();
  return { ok: true, via: "native" };
}

// Teams' own "new message" flow: the left-rail New message button opens a
// draft with a people picker ("To:"). Each pick adds a chip and the picker
// stays open for more. Teams then shows the chat with exactly those people:
// the existing one (its thread id appears), or an empty draft (no thread id)
// that Teams creates on the first send. Picking yourself jumps to 48:notes.
// Seen live 2026-11-19.
// Join a running meeting the way the stock UI does: open the conversation in
// Teams and press the "Join" button on that call's meeting card. Each card is
// labelled #meeting-object-label<rootId>, so the right call is targeted even
// with several cards on screen. No deep link (it would replace the Teams page).
const MEETING_JOIN = '[data-testid="meeting-object-join"]';

export async function joinNativeMeeting(
  conversationId: string,
  title: string,
  rootId: string,
  team?: string,
): Promise<WriteResult> {
  if (!(await openNativeChat(conversationId, title, team))) return { ok: false, reason: "chat not open in Teams" };
  const find = (): HTMLElement | null => {
    const card = document.getElementById("meeting-object-label" + rootId);
    const own = card?.querySelector<HTMLElement>(MEETING_JOIN);
    if (own) return own;
    // Fallback: exactly one join button on screen is unambiguous.
    const all = nativeAll(MEETING_JOIN);
    return all.length === 1 ? all[0] : null;
  };
  let btn = await waitFor(find, isChannelId(conversationId) ? 2500 : 4000);
  // Channels: the meeting card may be scrolled out of the (virtualized) posts
  // list. The channel header lists live meetings behind its Meet button, each
  // with a Join button keyed `liveJoinButton:<channelId>:<rootId>`.
  if (!btn && isChannelId(conversationId)) btn = await joinFromChannelHeader(conversationId, rootId);
  if (!btn) return { ok: false, reason: "no Join button in Teams" };
  if (nativeThreadId() !== conversationId) return { ok: false, reason: "Teams switched chats" };
  btn.click();
  return { ok: true, via: "native" };
}

const CHANNEL_MEET = '[data-tid="channel-meet-header-main-btn"]';
const CHANNEL_MEET_ITEM = '[data-tid="channel-header-meet-now-meet-btn"]';
const LIVE_JOIN = '[data-tid^="liveJoinButton:"]';
const ROSTER_JOIN = 'button[data-track-action-scenario="SlashCommandJoinMeetNow"]';

async function joinFromChannelHeader(channelId: string, rootId: string): Promise<HTMLElement | null> {
  const pick = (): HTMLElement | null => {
    const items = nativeAll(LIVE_JOIN);
    const own = items.find((b) =>
      (b.getAttribute("data-tid") || "").startsWith(`liveJoinButton:${channelId}:${rootId}`),
    );
    if (own) return own;
    if (items.length === 1) return items[0];
    const roster = nativeAll(ROSTER_JOIN);
    return roster.length === 1 ? roster[0] : null;
  };
  const ready = pick();
  if (ready) return ready;
  const trigger = nativeButton("#meeting-button") || nativeButton(CHANNEL_MEET);
  // No live meeting means the header shows plain "Meet now": never press it here.
  if (!trigger || trigger.getAttribute("aria-haspopup") == null) return null;
  trigger.click();
  return waitFor(pick, 2500);
}

export async function startNativeChannelMeeting(
  conversationId: string,
  title: string,
  team?: string,
): Promise<WriteResult> {
  if (!(await openNativeChat(conversationId, title, team))) return { ok: false, reason: "channel not open in Teams" };
  let btn = await waitFor(() => nativeButton(CHANNEL_MEET), 4000);
  if (!btn) return { ok: false, reason: "no Meet button in Teams" };
  if (nativeThreadId() !== conversationId) return { ok: false, reason: "Teams switched chats" };
  // While meetings run in the channel the header button opens a menu (live
  // meetings + "Meet now") instead of starting one; pick its Meet now item.
  if (btn.getAttribute("aria-haspopup") != null) {
    btn.click();
    btn = await waitFor(() => nativeButton(CHANNEL_MEET_ITEM), 2500);
    if (!btn) return { ok: false, reason: "no Meet now in Teams' meeting menu" };
  }
  if (btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled") === "true") {
    return { ok: false, reason: "Teams has meetings disabled for this channel" };
  }
  btn.click();
  return { ok: true, via: "native" };
}

const NEW_MESSAGE_BTN = '[data-testid^="simple-collab-left-rail-header-new-message"]';
const PEOPLE_PICKER = '[data-tid="people-picker-search"]';
const PICKER_OPTION = '[role="option"][data-tid^="people-picker-entry-"]';
// Chip per picked person: data-tid ends with their UPN (or email).
const PICKER_CHIP = '[data-tid^="people-picker-selected-user-"]';

/** A person to add in Teams' people picker. */
export interface PickPerson {
  /** UPN / email: Teams' option data-tid ends with it. */
  upn?: string;
  /** Entra object id: Teams' option data-tid contains it. */
  oid?: string;
}

export type NewChatResult = { ok: true; id: string; draft: boolean } | { ok: false; reason: string };

function chipCount(): number {
  return nativeAll(PICKER_CHIP).length;
}

// Chip button per picked person: id "recipient-line-entry-<mri>"; clicking it
// removes the person. Teams keeps a half-done draft (chips and all) across
// reopen and even restart, so the picker can start non-empty.
const CHIP_BUTTON = '[id^="recipient-line-entry-"]';

function chipButtons(): HTMLElement[] {
  return nativeAll(CHIP_BUTTON);
}

function chipIs(c: HTMLElement, p: PickPerson): boolean {
  const key = (c.id + " " + (c.querySelector(PICKER_CHIP)?.getAttribute("data-tid") || "")).toLowerCase();
  const upn = (p.upn || "").trim().toLowerCase();
  const oid = (p.oid || "").trim().toLowerCase();
  return (!!oid && key.includes(oid)) || (!!upn && key.endsWith(upn));
}

// Make the picker's chips exactly `list`: drop anyone else, report who is in.
async function reconcileChips(list: PickPerson[]): Promise<Set<PickPerson>> {
  for (const c of chipButtons()) {
    if (list.some((p) => chipIs(c, p))) continue;
    const n = chipButtons().length;
    c.click();
    await waitFor(() => chipButtons().length < n, 1500);
  }
  return new Set(list.filter((p) => chipButtons().some((c) => chipIs(c, p))));
}

function matchesOption(o: Element, p: PickPerson): boolean {
  const tid = (o.getAttribute("data-tid") || "").toLowerCase();
  const upn = (p.upn || "").trim().toLowerCase();
  const oid = (p.oid || "").trim().toLowerCase();
  return (!!upn && tid.endsWith(upn)) || (!!oid && tid.includes(oid));
}

// Type into the picker and click the one suggestion that matches `p`.
async function pickPerson(p: PickPerson): Promise<boolean> {
  const input = await waitFor(() => document.querySelector<HTMLInputElement>(PEOPLE_PICKER));
  if (!input) return false;
  const query = (p.upn || p.oid || "").trim();
  if (!query) return false;
  const n = chipCount();
  input.focus();
  // React tracks input values: set through the native setter, then fire input.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, query);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const opt = await waitFor(
    () =>
      [...document.querySelectorAll<HTMLElement>(PICKER_OPTION)].find(
        (o) => !o.closest("#tc-root") && matchesOption(o, p),
      ),
    5000,
  );
  if (!opt) return false;
  opt.click();
  // A chip appears (or, for a single person, Teams may jump straight to the chat).
  await waitFor(() => chipCount() > n || !document.querySelector(PEOPLE_PICKER), 2000);
  return true;
}

// Thread id once Teams stops switching views: unchanged for `quiet` ms.
async function settledThreadId(ms = 3000, quiet = 700): Promise<string> {
  let last = nativeThreadId();
  let since = Date.now();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(100);
    const t = nativeThreadId();
    if (t !== last) {
      last = t;
      since = Date.now();
    } else if (Date.now() - since >= quiet) break;
  }
  return last;
}

/**
 * Start a chat with `people` exactly as the stock UI does: New message, then
 * add each person in the people picker. Only a suggestion whose data-tid
 * matches the person's UPN or object id is clicked. Never sends.
 * Resolves with the chat Teams shows: its id, or draft=true for a new chat.
 */
export function openNativeNewChat(people: PickPerson[]): Promise<NewChatResult> {
  return drive(() => pickNewChat(people));
}

async function pickNewChat(people: PickPerson[]): Promise<NewChatResult> {
  const list = people.filter((p) => (p.upn || p.oid || "").trim());
  if (!list.length) return { ok: false, reason: "no one to add" };
  const btn = nativeButton(NEW_MESSAGE_BTN);
  if (!btn) return { ok: false, reason: "no New message button in Teams" };
  btn.click();
  if (!(await waitFor(() => document.querySelector(PEOPLE_PICKER)))) {
    return { ok: false, reason: "no people picker in Teams" };
  }
  // Each pick re-resolves the conversation: after the first one Teams shows
  // that person's 1:1 for a moment, which must not be taken for the group's.
  const already = await reconcileChips(list);
  if (chipButtons().length > already.size) return { ok: false, reason: "couldn't clear Teams' earlier draft" };
  let firstId = "";
  for (const [i, p] of list.entries()) {
    if (already.has(p)) continue;
    if (!(await pickPerson(p))) return { ok: false, reason: "person not found in Teams: " + (p.upn || p.oid) };
    if (i === 0) firstId = nativeThreadId();
  }
  if (list.length > 1) {
    // All chips in, then let the thread id settle on the final set.
    await waitFor(() => chipCount() >= list.length || !document.querySelector(PEOPLE_PICKER), 6000);
    let id = await settledThreadId(5000, 1200);
    if (id && id === firstId) id = "";
    return { ok: true, id, draft: !id && !!document.querySelector(PEOPLE_PICKER) };
  }
  const id = await settledThreadId();
  return { ok: true, id, draft: !id && !!document.querySelector(PEOPLE_PICKER) };
}

/** Open the 1:1 chat with one person (see openNativeNewChat). */
export async function openNativeDirect(upn: string, oid?: string): Promise<NewChatResult> {
  return openNativeNewChat([{ upn, oid }]);
}

/**
 * Send the first message of the new-chat draft Teams shows right now, which
 * creates the chat. Safety: aborts unless the draft's chips are exactly
 * `people` (by UPN), so text never goes to a different set of people.
 * Resolves with the new chat's id ("" if Teams has not switched yet).
 */
export function sendNativeDraft(
  people: PickPerson[],
  text: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  return drive(() => sendDraft(people, text));
}

async function sendDraft(
  people: PickPerson[],
  text: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  if (!text || !text.trim()) return { ok: false, reason: "empty" };
  const want = people
    .map((p) => (p.upn || "").trim().toLowerCase())
    .filter(Boolean)
    .sort();
  const chipsOk = (): boolean => {
    if (nativeThreadId()) return false; // an existing chat, not the draft
    const got = [...document.querySelectorAll(PICKER_CHIP)]
      .filter((c) => !c.closest("#tc-root"))
      .map((c) => (c.getAttribute("data-tid") || "").slice("people-picker-selected-user-".length).toLowerCase())
      .sort();
    return want.length === people.length && got.length === want.length && got.every((g, i) => g === want[i]);
  };
  if (!chipsOk()) return { ok: false, reason: "draft-changed" };
  const composer = await waitFor(
    () =>
      document.querySelector<HTMLElement>('[data-tid="ckeditor"][id^="new-message-"][contenteditable="true"]') ||
      document.querySelector<HTMLElement>('[id^="new-message-"][contenteditable="true"]'),
  );
  if (!composer || composer.closest("#tc-root")) return { ok: false, reason: "no-composer" };
  setComposerText(composer, text);
  const btn = await waitFor(() => {
    const b = [...document.querySelectorAll<HTMLButtonElement>(SEND_BUTTON)].find((x) => !x.closest("#tc-root"));
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, 1500);
  // Re-check right before sending: the user may have changed the draft.
  if (!chipsOk()) return { ok: false, reason: "draft-changed" };
  if (!btn) return { ok: false, reason: "no-send-button" };
  btn.click();
  const id = await waitFor(() => nativeThreadId(), 8000);
  return { ok: true, id };
}

// Teams' native attach flow. The "attach" button opens a menu whose "upload
// from this device" entry is backed by a plain multiple file input; setting
// its files and firing change starts Teams' own upload (AMS + SharePoint, see
// docs/file-send-flow.md). Each uploaded file then shows as a card in the
// file well whose title carries its SharePoint URL.
const FILE_PICKER = '[data-tid="sendMessageCommands-FilePicker"], [data-tid="newMessageCommands-FilePicker"]';
const FILE_INPUT = '[data-tid="file-upload-from-pc"] input[type="file"]';
const FILE_WELL = '[data-tid="file-well"]';
const FILE_CARD = FILE_WELL + ' [data-testid="content-card-custom-title"]';
const FILE_REMOVE = FILE_WELL + ' [data-testid="close-button"]';

const uploadedCount = (): number =>
  [...document.querySelectorAll(FILE_CARD)].filter((e) => /https:\/\//.test(e.getAttribute("aria-label") || "")).length;

function clearFileWell(): void {
  document.querySelectorAll<HTMLElement>(FILE_REMOVE).forEach((b) => b.click());
}

interface CkEditor {
  setData(html: string): void;
}

/**
 * Send `files` (and optional markdown-lite `text`) to a chat through Teams'
 * own composer, so Teams uploads them with its own tokens. Safety as in
 * sendMessage: aborts unless the native composer targets `conversationId`.
 * Text goes in through CKEditor's API; typing into its DOM is not seen by
 * its model, and the send would go out without it. Mentions stay plain text.
 */
export async function sendFiles(
  conversationId: string,
  title: string,
  text: string,
  files: File[],
): Promise<WriteResult> {
  if (!files.length) return { ok: false, reason: "empty" };
  const opened = await openNativeChat(conversationId, title);
  if (!opened || nativeThreadId() !== conversationId)
    return { ok: false, reason: opened ? "wrong-chat" : "chat-not-open" };
  const composer = await waitFor(findComposer);
  if (!composer) return { ok: false, reason: "no-composer" };
  // Files the user staged in Teams itself would go out with ours.
  if (document.querySelector(FILE_WELL + " [role=group]")) return { ok: false, reason: "native-busy" };

  document.querySelector<HTMLElement>(FILE_PICKER)?.click();
  const input = await waitFor(() => document.querySelector<HTMLInputElement>(FILE_INPUT), 2000);
  if (!input) return { ok: false, reason: "no-file-input" };
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (document.querySelector('[role="menu"]')) {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  }

  // Generous: 30 s plus 20 s per MB (a slow 50 KB/s link).
  const bytes = files.reduce((n, f) => n + f.size, 0);
  const done = await waitFor(() => uploadedCount() >= files.length, 30_000 + bytes / 50, 250);
  const fail = (reason: string): WriteResult => {
    clearFileWell();
    return { ok: false, reason };
  };
  if (!done) return fail("upload-timeout");
  if (nativeThreadId() !== conversationId) return fail("wrong-chat");

  const html = text.trim() ? formatMessage(text).html : "";
  const ck = (composer as HTMLElement & { ckeditorInstance?: CkEditor }).ckeditorInstance;
  if (ck) ck.setData(html);
  else if (text.trim()) setComposerText(composer, text);

  const btn = await waitFor(() => {
    const b = document.querySelector<HTMLButtonElement>(SEND_BUTTON);
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, 1500);
  // Re-check right before sending: the user may have clicked elsewhere.
  if (nativeThreadId() !== conversationId) return fail("wrong-chat");
  if (!btn) return fail("no-send-button");
  btn.click();
  return { ok: true, via: "button" };
}

function findComposer(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-tid="ckeditor"][contenteditable="true"]') ||
    document.querySelector<HTMLElement>('[data-tid="ckeditor"] [contenteditable="true"]') ||
    document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"]')
  );
}

// Insert text into a contenteditable the way a paste does, so Teams' editor
// picks it up through its own input handling.
function setComposerText(el: HTMLElement, text: string): void {
  el.focus();
  const sel = window.getSelection();
  if (sel) sel.selectAllChildren(el);
  const ok = document.execCommand && document.execCommand("insertText", false, text);
  if (!ok) {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }
}

export async function sendMessage(conversationId: string, title: string, text: string): Promise<WriteResult> {
  if (!text || !text.trim()) return { ok: false, reason: "empty" };
  const opened = await openNativeChat(conversationId, title);
  if (!opened) return { ok: false, reason: "chat-not-open" };
  if (nativeThreadId() !== conversationId) return { ok: false, reason: "wrong-chat" };

  const composer = await waitFor(findComposer);
  if (!composer) return { ok: false, reason: "no-composer" };
  // setComposerText selects all: never replace what the user typed in Teams.
  if (composer.textContent?.trim()) return { ok: false, reason: "native-draft" };
  setComposerText(composer, text);

  const btn = await waitFor(() => {
    const b = document.querySelector<HTMLButtonElement>(SEND_BUTTON);
    return b && !b.disabled && b.getAttribute("aria-disabled") !== "true" ? b : null;
  }, 1500);
  // Re-check right before sending: the user may have clicked elsewhere.
  if (nativeThreadId() !== conversationId) return { ok: false, reason: "wrong-chat" };
  // Teams empties its composer once the message is handed off; anything else
  // means we cannot tell whether it was sent.
  const cleared = (): boolean => !composer.isConnected || !composer.textContent?.trim();
  if (btn) {
    btn.click();
    if (!(await waitFor(() => cleared() || null, 3000))) return { ok: false, reason: "not-confirmed" };
    return { ok: true, via: "button" };
  }
  const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
  composer.dispatchEvent(new KeyboardEvent("keydown", opts));
  composer.dispatchEvent(new KeyboardEvent("keyup", opts));
  if (!(await waitFor(() => cleared() || null, 3000))) return { ok: false, reason: "not-confirmed" };
  return { ok: true, via: "enter" };
}
