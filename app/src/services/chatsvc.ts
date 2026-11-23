// chatsvc: messages and conversation properties — the backend Teams' chat UI
// reads and writes. Every route and body below was captured from the native
// client (Nov 2026). Returns raw payloads; normalizing is teamsData.ts' job.

import { chatAud, region } from "./auth";
import { call, type Res } from "./http";

const base = (): string => `/api/chatsvc/${region("chatsvc")}/v1/users/ME/conversations`;
const conv = (cid: string): string => `${base()}/${encodeURIComponent(cid)}`;
const msg = (cid: string, mid: string): string => `${conv(cid)}/messages/${encodeURIComponent(mid)}`;

// Teams sends this on every chatsvc write; without it some errors come back as
// redirects instead of status codes.
const WRITE = { behavioroverride: "redirectAs404" };

export interface MessagePage {
  messages?: unknown[];
  _metadata?: { backwardLink?: string; syncState?: string };
}

/** Newest page of a conversation. chatsvc caps pageSize at 200. */
export function getMessages(cid: string, pageSize = 30): Promise<Res<MessagePage>> {
  const n = Math.max(1, Math.min(pageSize, 200));
  return call<MessagePage>(
    chatAud(),
    `${conv(cid)}/messages?view=msnp24Equivalent%7CsupportsMessageProperties&pageSize=${n}&startTime=1`,
  );
}

/** Follow a page's _metadata.backwardLink (absolute URL) to the next older page. */
export function getMessagesByLink(link: string): Promise<Res<MessagePage>> {
  return call<MessagePage>(chatAud(), link);
}

/** Post a message. `payload` is the full native message body. */
export function postMessage(cid: string, payload: Record<string, unknown>): Promise<Res> {
  return call(chatAud(), `${conv(cid)}/messages`, { method: "POST", headers: WRITE, body: payload });
}

/** Replace a message's content (edit). */
export function putMessage(cid: string, mid: string, content: string): Promise<Res> {
  return call(chatAud(), msg(cid, mid), {
    method: "PUT",
    headers: WRITE,
    body: { content, messagetype: "RichText/Html", contenttype: "Text" },
  });
}

/** Soft delete. The ?behavior=softDelete query is REQUIRED: bare DELETE hard-removes. */
export function softDeleteMessage(cid: string, mid: string): Promise<Res> {
  return call(chatAud(), `${msg(cid, mid)}?behavior=softDelete`, {
    method: "DELETE",
    headers: { ...WRITE, "content-type": "application/json" },
  });
}

/** Undo a soft delete by clearing the deletetime property. */
export function undoSoftDelete(cid: string, mid: string): Promise<Res> {
  return call(chatAud(), `${msg(cid, mid)}/properties?name=deletetime`, {
    method: "DELETE",
    headers: WRITE,
    body: { deletetime: null },
  });
}

/**
 * Add/remove a reaction. The ?name=emotions sub-resource is REQUIRED: a bare
 * DELETE on the message route deletes the whole message.
 */
export function putReaction(cid: string, mid: string, key: string, add: boolean): Promise<Res> {
  return call(chatAud(), `${msg(cid, mid)}/properties?name=emotions`, {
    method: add ? "PUT" : "DELETE",
    headers: WRITE,
    body: add ? { emotions: { key, value: Date.now() } } : { emotions: { key } },
  });
}

/** Replace one message property, e.g. "files" (a JSON string, like Teams stores it). */
export function putMessageProperty(cid: string, mid: string, name: string, value: string): Promise<Res> {
  return call(chatAud(), `${msg(cid, mid)}/properties?name=${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: WRITE,
    body: { [name]: value },
  });
}

/** Set one conversation property (consumptionhorizon, consumptionHorizonBookmark, …). */
export function putConversationProperty(cid: string, name: string, value: string): Promise<Res> {
  return call(chatAud(), `${conv(cid)}/properties?name=${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: WRITE,
    body: { [name]: value },
  });
}
