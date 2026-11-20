// Session-local caches shared by the readers (chats, messages) and the writers.
import type { Message } from "../types";
import type { chat } from "../services";

// Teams only renders a "This message was deleted / Undo" stub for messages it
// still holds undo state for (IDB deletionInfo). Every other soft-deleted
// message is hidden entirely. Mirror that, plus keep stubs for messages deleted
// from this overlay in this session so their Undo stays reachable.
export const deletedHere = new Set<string>();

// messageId -> {clientMessageId, time} for every message we normalized: CDL
// edit/delete/read take these, while the UI only passes message ids. Bounded.
export const msgRefs = new Map<string, { clientMessageId: string; time: number }>();
const MAX_REFS = 5000;

export function rememberRef(id: string, clientMessageId: string, time: number): void {
  if (!id || !time) return;
  msgRefs.delete(id);
  msgRefs.set(id, { clientMessageId, time });
  if (msgRefs.size > MAX_REFS) msgRefs.delete(msgRefs.keys().next().value as string);
}

// Each chat's newest message, from the chat list: what Teams' mark read/unread key on.
export const lastByConv = new Map<string, chat.MsgRef>();

// Channel posts carry reply-chain state the CDL layer does not model yet; they
// stay on the chatsvc REST path.
export const isChannelId = (id: string): boolean => /@thread\.(tacv2|skype)$/.test(id);

// 1:1 chats live under "<a>_<b>@unq.gbl.spaces" (or are threads flagged
// uniquerosterthread, see listChats).
export const isOneToOneId = (id: string): boolean => /@unq\.gbl\.spaces$/.test(id);

// Uncached chats poll every few seconds but their IndexedDB stays empty, so
// cache the remote result briefly to avoid hammering chatsvc on every tick.
// Kept just under the UI poll interval (4s) so a new message shows within one
// tick instead of waiting out a long cache.
export const REMOTE_TTL = 3500;
export const remoteCache = new Map<string, { at: number; msgs: Message[] }>();
