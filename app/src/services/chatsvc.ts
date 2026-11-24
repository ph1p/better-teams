// chatsvc: messages and conversation properties — the backend Teams' chat UI
// reads and writes. Every route and body below was captured from the native
// client (Nov 2026). Returns raw payloads.

import { chatAud, region } from "./auth";
import { call } from "./http";

const base = () => `/api/chatsvc/${region("chatsvc")}/v1/users/ME/conversations`;
const conv = (cid: string) => `${base()}/${encodeURIComponent(cid)}`;
const msg = (cid: string, mid: string) => `${conv(cid)}/messages/${encodeURIComponent(mid)}`;

// Teams sends this on every chatsvc write; without it some errors come back as
// redirects instead of status codes.
const WRITE = { behavioroverride: "redirectAs404" };

export interface MessagePage {
  messages?: unknown[];
  _metadata?: { backwardLink?: string; syncState?: string };
}

// chatsvc caps pageSize at 200.
export function getMessages(cid: string, pageSize = 30) {
  const n = Math.max(1, Math.min(pageSize, 200));
  return call<MessagePage>(
    chatAud(),
    `${conv(cid)}/messages?view=msnp24Equivalent%7CsupportsMessageProperties&pageSize=${n}&startTime=1`,
  );
}

// `link` is a page's _metadata.backwardLink (absolute URL).
export function getMessagesByLink(link: string) {
  return call<MessagePage>(chatAud(), link);
}

export function postMessage(cid: string, payload: Record<string, unknown>) {
  return call(chatAud(), `${conv(cid)}/messages`, { method: "POST", headers: WRITE, body: payload });
}

export function putMessage(cid: string, mid: string, content: string) {
  return call(chatAud(), msg(cid, mid), {
    method: "PUT",
    headers: WRITE,
    body: { content, messagetype: "RichText/Html", contenttype: "Text" },
  });
}

// The ?behavior=softDelete query is REQUIRED: bare DELETE hard-removes.
export function softDeleteMessage(cid: string, mid: string) {
  return call(chatAud(), `${msg(cid, mid)}?behavior=softDelete`, {
    method: "DELETE",
    headers: { ...WRITE, "content-type": "application/json" },
  });
}

export function undoSoftDelete(cid: string, mid: string) {
  return call(chatAud(), `${msg(cid, mid)}/properties?name=deletetime`, {
    method: "DELETE",
    headers: WRITE,
    body: { deletetime: null },
  });
}

// The ?name=emotions sub-resource is REQUIRED: a bare DELETE on the message
// route deletes the whole message.
export function putReaction(cid: string, mid: string, key: string, add: boolean) {
  return call(chatAud(), `${msg(cid, mid)}/properties?name=emotions`, {
    method: add ? "PUT" : "DELETE",
    headers: WRITE,
    body: add ? { emotions: { key, value: Date.now() } } : { emotions: { key } },
  });
}

// e.g. "files" (a JSON string, like Teams stores it).
export function putMessageProperty(cid: string, mid: string, name: string, value: string) {
  return call(chatAud(), `${msg(cid, mid)}/properties?name=${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: WRITE,
    body: { [name]: value },
  });
}

// e.g. consumptionhorizon, consumptionHorizonBookmark.
export function putConversationProperty(cid: string, name: string, value: string) {
  return call(chatAud(), `${conv(cid)}/properties?name=${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: WRITE,
    body: { [name]: value },
  });
}
