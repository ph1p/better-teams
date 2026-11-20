// Mock of src/send.ts. The real module drives Teams' own DOM (open a chat,
// press its call button, use its people picker); here those actions resolve
// against the store, and calls just report that they would have started.
import type { WriteResult } from "../types";
import type { NewChatResult, PickPerson } from "../send";
import { ME, PEOPLE } from "./fixtures";
import * as store from "./store";

const later = <T>(v: T, ms = 150): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

function mriOf(p: PickPerson): string {
  const hit = PEOPLE.find((x) => (p.oid && x.mri.endsWith(p.oid)) || (p.upn && x.email === p.upn.toLowerCase()));
  return hit ? hit.mri : "";
}

export async function openNativeChat(conversationId: string, _title?: string): Promise<boolean> {
  return !!store.getChat(conversationId);
}

function callNotice(what: string): WriteResult {
  console.info(`[mock] ${what}: no Teams here, nothing started.`);
  return { ok: false, reason: "mock: calls need Teams" };
}

export async function startNativeCall(_conversationId: string, title: string, kind: "audio" | "video"): Promise<WriteResult> {
  return callNotice(`${kind} call with ${title}`);
}

export async function joinNativeMeeting(_conversationId: string, title: string, _rootId: string): Promise<WriteResult> {
  return callNotice(`join meeting in ${title}`);
}

export async function startNativeChannelMeeting(_conversationId: string, title: string): Promise<WriteResult> {
  return callNotice(`meet now in ${title}`);
}

export async function openNativeNewChat(people: PickPerson[]): Promise<NewChatResult> {
  const mris = people.map(mriOf).filter(Boolean);
  if (!mris.length || mris.length !== people.length) return later({ ok: false, reason: "person not found" });
  const id = store.chatWith(mris);
  // A chat without messages is a draft: Teams creates it on the first send.
  return later({ ok: true, id, draft: !store.getChat(id)?.messages.length });
}

export async function openNativeDirect(upn: string, oid?: string): Promise<NewChatResult> {
  return openNativeNewChat([{ upn, ...(oid ? { oid } : {}) }]);
}

export async function sendNativeDraft(people: PickPerson[], text: string): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const r = await openNativeNewChat(people);
  if (!r.ok) return r;
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  store.post(r.id, ME, `<p>${esc}</p>`);
  return { ok: true, id: r.id };
}

export async function sendMessage(conversationId: string, _title: string, text: string): Promise<WriteResult> {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return store.post(conversationId, ME, `<p>${esc}</p>`) ? { ok: true, via: "mock" } : { ok: false, reason: "unknown chat" };
}
