// Mock of src/services/chat.ts. Only watchChatEvents carries real behaviour
// (the store's events); the writes exist for parity and act on the store too.
import type { CdlRes } from "../../services/cdl";
import type { ChatEvent, MessagePage, MsgRef, SendInput } from "../../services/chat";
import { ME } from "../fixtures";
import * as store from "../store";

const done: CdlRes<true> = { ok: true, data: true };
const no = <T>(reason: string): CdlRes<T> => ({ ok: false, reason });

export function newClientMessageId(): string {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < 19) s += Math.floor(Math.random() * 10);
  return s;
}

export async function sendMessage(i: SendInput): Promise<CdlRes<{ id: string; originalArrivalTime?: string }>> {
  if (i.edit) {
    return store.edit(i.convId, i.edit.id, i.content) ? { ok: true, data: { id: i.edit.id } } : no("not yours");
  }
  const m = store.post(i.convId, ME, i.content, i.replyChainId);
  return m ? { ok: true, data: { id: m.id, originalArrivalTime: new Date(m.time).toISOString() } } : no("unknown chat");
}

export async function deleteMessage(
  convId: string,
  msg: { id: string; clientMessageId: string },
): Promise<CdlRes<true>> {
  return store.setDeleted(convId, msg.id, true) ? done : no("not yours");
}

export async function setEmotion(convId: string, messageId: string, key: string, add: boolean): Promise<CdlRes<true>> {
  return store.react(convId, messageId, key, add) ? done : no("unknown message");
}

export async function markRead(convId: string, _last: MsgRef): Promise<CdlRes<true>> {
  return store.setRead(convId, true) ? done : no("unknown chat");
}

export function markChannelRead(convId: string, last: MsgRef): Promise<CdlRes<true>> {
  return markRead(convId, last);
}

export async function markUnread(convId: string, _last: MsgRef): Promise<CdlRes<true>> {
  return store.setRead(convId, false) ? done : no("unknown chat");
}

export async function listMessages(convId: string, _cursor?: string): Promise<CdlRes<MessagePage>> {
  const list = store.recent(convId);
  return list
    ? { ok: true, data: { messages: [...list].reverse(), older: null, available: true } }
    : no("unknown chat");
}

export async function setChatHidden(convId: string, hidden: boolean): Promise<CdlRes<true>> {
  return store.setHidden(convId, hidden) ? done : no("unknown chat");
}

export function watchChatEvents(convId: string, onEvents: (events: ChatEvent[]) => void): () => void {
  return store.onChatEvent((id, type, messageId) => {
    if (id === convId) onEvents([{ type, convId: id, ...(messageId ? { messageId } : {}) }]);
  });
}
