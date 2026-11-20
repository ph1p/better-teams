// Mock of src/teamsData.ts: same exports, backed by the in-memory store instead
// of Teams' IndexedDB and chatsvc. parity.ts keeps the signatures in sync.
import type { Chat, Message, Profile, Quote, WriteResult } from "../types";
import type { MentionPick } from "../mentions";
import { buildMentionContent } from "../mentions";
import { buildQuoteHtml } from "../quote";
import { ME, ME_OID, PEOPLE } from "./fixtures";
import * as store from "./store";

export interface PeopleHit {
  mri: string;
  displayName: string;
  email: string;
  jobTitle: string;
}

const ok: WriteResult = { ok: true, via: "mock" };
const fail = (reason: string): WriteResult => ({ ok: false, reason });
const later = <T>(v: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

export let CURRENT_OID = ME_OID;
export const myMri = (): string => (CURRENT_OID ? "8:orgid:" + CURRENT_OID : "");

/** No photos in the mock: the UI falls back to initials. */
export function profilePhotoUrl(_mri: string): string {
  return "";
}

export async function loadProfiles(): Promise<Record<string, Profile>> {
  return store.profiles;
}

const EMPTY_PROFILE: Profile = {
  displayName: "", imageUri: "", email: "", jobTitle: "", department: "", officeLocation: "",
};
export function profile(mri: string): Profile {
  return store.profiles[mri] || EMPTY_PROFILE;
}

export async function listChats(): Promise<Chat[]> {
  return store.listChats();
}

export async function listMessages(
  conversationId: string,
  _opts: { channel?: boolean; limit?: number; remoteLimit?: number } = {},
): Promise<Message[] | null> {
  return store.recent(conversationId);
}

export async function fetchOlderRemote(conversationId: string, _channel = false): Promise<Message[] | null> {
  return later(store.older(conversationId), 300);
}

export async function primeRemote(conversationId: string, _channel = false): Promise<Message[] | null> {
  store.resetPaging(conversationId);
  return [];
}

export async function sendRemote(
  conversationId: string,
  text: string,
  quote: Quote | null,
  mentions: readonly MentionPick[] = [],
  rootId?: string,
): Promise<WriteResult> {
  const body = (text || "").trim();
  if (!body) return fail("empty");
  const html = buildQuoteHtml(quote) + "<p>" + buildMentionContent(body, mentions).html.replace(/\n/g, "<br>") + "</p>";
  await later(null);
  return store.post(conversationId, ME, html, rootId) ? ok : fail("unknown chat");
}

export async function searchPeople(query: string, size = 8): Promise<PeopleHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = PEOPLE
    .filter((p) => p.mri !== ME)
    .filter((p) => p.displayName.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))
      || p.displayName.toLowerCase().startsWith(q) || p.email.startsWith(q))
    .slice(0, size)
    .map((p) => ({ mri: p.mri, displayName: p.displayName, email: p.email, jobTitle: p.jobTitle }));
  return later(hits, 200);
}

export async function setChatHidden(conversationId: string, hidden: boolean): Promise<WriteResult> {
  return store.setHidden(conversationId, hidden) ? ok : fail("unknown chat");
}

export async function markRead(conversationId: string, _lastMessageMs?: number): Promise<WriteResult> {
  return store.setRead(conversationId, true) ? ok : fail("unknown chat");
}

export async function markUnread(conversationId: string, _lastMessageMs?: number): Promise<WriteResult> {
  return store.setRead(conversationId, false) ? ok : fail("unknown chat");
}

export async function setReaction(
  conversationId: string,
  messageId: string,
  key: string,
  add: boolean,
): Promise<WriteResult> {
  return store.react(conversationId, messageId, key, add) ? ok : fail("unknown message");
}

export async function deleteMessage(conversationId: string, messageId: string): Promise<WriteResult> {
  return store.setDeleted(conversationId, messageId, true) ? ok : fail("not yours");
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  text: string,
  quoteHtml = "",
): Promise<WriteResult> {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return store.edit(conversationId, messageId, quoteHtml + "<p>" + esc.replace(/\n/g, "<br>") + "</p>")
    ? ok : fail("not yours");
}

export async function undoDelete(conversationId: string, messageId: string): Promise<WriteResult> {
  return store.setDeleted(conversationId, messageId, false) ? ok : fail("not yours");
}
