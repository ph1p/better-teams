// Message writes: send, react, delete, edit, undo, remove a file. Worker (CDL) first where it
// is safe, chatsvc REST as fallback.
import type { FileRef, Quote, WriteResult } from "../types";
import type { MentionPick } from "../mentions";
import { formatMessage } from "../markdown";
import { buildQuoteHtml } from "../quote";
import { chat, chatsvc, token } from "../services";
import { myMri } from "./idb";
import { profile } from "./profiles";
import { arr, get, str, toWrite } from "./raw";
import { deletedHere, isChannelId, msgRefs, remoteCache } from "./state";

// cdl's error when the worker channel isn't learned yet: nothing was sent, so
// falling back to REST is safe.
const NOT_READY = "Teams worker channel not ready";

// properties.mentions JSON (mentions.ts) -> Teams' MentionInput list.
function mentionInputs(json: string): chat.MentionInput[] {
  try {
    return arr(JSON.parse(json)).map((e) => ({
      itemId: String(get(e, "itemid") ?? ""),
      userId: str(get(e, "mri")),
      mentionType: str(get(e, "mentionType")) || "person",
      displayName: str(get(e, "displayName")),
    }));
  } catch {
    return [];
  }
}

// Send a text message through the exact chatsvc endpoint Teams itself POSTs to,
// with Teams' own live token. Mirrors the captured native-send body 1:1. Returns
// { ok, reason? }. Returns { ok:false, reason:"no-token" } when no bearer is
// available yet, so the caller can fall back to the native composer.
// `quote`, when given, is the message being quote-replied to:
// { id, from, text, fromMri }. It prepends a Skype Reply blockquote exactly as
// Teams' native quote-reply does, so the reply threads to that message.
export async function sendRemote(
  conversationId: string,
  text: string,
  quote: Quote | null,
  mentions: readonly MentionPick[] = [],
  /** Channel thread to reply in (the root message id). Ignored for chats. */
  rootId?: string
): Promise<WriteResult> {
  const body = (text || "").trim();
  if (!body) return { ok: false, reason: "empty" };
  // Markdown-lite → native Teams HTML, with any @mention spans spliced in.
  const mc = formatMessage(body, mentions);
  // Native quote-reply: prepend the Skype Reply blockquote (captured format).
  const content = buildQuoteHtml(quote) + mc.html;
  const clientMessageId = chat.newClientMessageId();
  const channel = isChannelId(conversationId);
  const reply = !!rootId && channel;
  // Chats, channel posts and thread replies all go through the CDL worker,
  // which holds its own tokens; native compose for a reply sets
  // convId=channel, replyChainId=root, sendFromChannel_ToBeRefactored.
  const r = await chat.sendMessage({
    convId: conversationId,
    content,
    clientMessageId,
    mentions: mentionInputs(mc.mentions),
    channel,
    ...(reply ? { replyChainId: rootId } : {}),
  });
  if (r.ok) {
    remoteCache.delete(conversationId);
    return { ok: true, via: "cdl" };
  }
  // Fall back only when the request never reached the worker; any later
  // failure may already have sent, and a retry would post twice.
  if (r.reason !== NOT_READY) return { ok: false, reason: r.reason };
  if (!token("ic3")) return { ok: false, reason: reply ? "no-token-thread" : "no-token" };
  // chatsvc addresses a channel thread as "<channelId>;messageid=<rootId>".
  const target = reply ? `${conversationId};messageid=${rootId}` : conversationId;
  const mri = myMri();
  const now = new Date().toISOString();
  const payload = {
    id: "-1",
    type: "Message",
    conversationid: conversationId,
    conversationLink: "blah/" + target,
    from: mri,
    fromUserId: mri,
    composetime: now,
    originalarrivaltime: now,
    content,
    messagetype: "RichText/Html",
    contenttype: "Text",
    imdisplayname: profile(mri).displayName || "",
    clientmessageid: clientMessageId,
    callId: "",
    state: 0,
    version: "0",
    amsreferences: [] as string[],
    properties: {
      importance: "",
      subject: "",
      title: "",
      cards: "[]",
      links: "[]",
      mentions: mc.mentions,
      onbehalfof: null,
      files: "[]",
      policyViolation: null,
      formatVariant: "TEAMS",
    },
    crossPostChannels: [] as string[],
  };
  const rest = await chatsvc.postMessage(target, payload);
  if (!rest.ok) return toWrite(rest);
  // Our cached view is now stale; drop it so the next poll re-fetches.
  remoteCache.delete(conversationId);
  return { ok: true, via: "endpoint" };
}

// Add or remove a reaction on a message. Captured from the native client:
//   add    PUT    .../messages/<id>/properties?name=emotions  {"emotions":{"key":<k>,"value":<ms>}}
//   remove DELETE .../messages/<id>/properties?name=emotions  {"emotions":{"key":<k>}}
// The ?name=emotions sub-resource is REQUIRED: a bare DELETE on .../messages/<id>
// is the message-DELETE route and removes the whole message. <k> is the reaction
// key ("like","heart","laugh",…), same ic3 bearer as send. Real server write that
// syncs to all devices.
export async function setReaction(
  conversationId: string,
  messageId: string,
  key: string,
  add: boolean
): Promise<WriteResult> {
  if (!isChannelId(conversationId)) {
    const c = await chat.setEmotion(conversationId, messageId, key, add);
    if (c.ok) {
      remoteCache.delete(conversationId);
      return { ok: true, via: "cdl" };
    }
  }
  const r = await chatsvc.putReaction(conversationId, messageId, key, add);
  if (!r.ok) return toWrite(r);
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Soft-delete a message. Captured from the native client:
//   DELETE .../messages/<id>?behavior=softDelete
// The ?behavior=softDelete query is REQUIRED: a bare DELETE hard-removes. Soft
// delete is reversible via undoDelete(). Real write, syncs to all devices.
export async function deleteMessage(conversationId: string, messageId: string): Promise<WriteResult> {
  const ref = msgRefs.get(String(messageId));
  if (!isChannelId(conversationId)) {
    const c = await chat.deleteMessage(conversationId, { id: String(messageId), clientMessageId: ref?.clientMessageId || "" });
    if (c.ok) {
      deletedHere.add(String(messageId));
      remoteCache.delete(conversationId);
      return { ok: true, via: "cdl" };
    }
  }
  const r = await chatsvc.softDeleteMessage(conversationId, messageId);
  if (!r.ok) return toWrite(r);
  deletedHere.add(String(messageId));
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Edit a message's text. chatsvc edit route:
//   PUT .../messages/<id>  {"content":"<html>","messagetype":"RichText/Html","contenttype":"Text"}
// content is wrapped in <p> like a fresh send. Real write, syncs to all devices.
// `quoteHtml`, when given, is a verbatim leading blockquote (from splitQuote)
// preserved across the edit; pass "" to drop a quote the user removed.
export async function editMessage(
  conversationId: string,
  messageId: string,
  text: string,
  quoteHtml = ""
): Promise<WriteResult> {
  const content = (quoteHtml || "") + formatMessage(String(text)).html;
  const ref = msgRefs.get(String(messageId));
  if (ref && !isChannelId(conversationId)) {
    const c = await chat.sendMessage({
      convId: conversationId,
      content,
      clientMessageId: ref.clientMessageId || chat.newClientMessageId(),
      edit: { id: String(messageId), time: ref.time },
    });
    if (c.ok) {
      remoteCache.delete(conversationId);
      return { ok: true, via: "cdl" };
    }
    // An edit is idempotent, so retrying over REST is safe.
  }
  const r = await chatsvc.putMessage(conversationId, messageId, content);
  if (!r.ok) return toWrite(r);
  remoteCache.delete(conversationId);
  return { ok: true };
}

// Undo a soft-delete by clearing the message's deletetime property. Captured:
//   DELETE .../messages/<id>/properties?name=deletetime   body {"deletetime":null}
export async function undoDelete(conversationId: string, messageId: string): Promise<WriteResult> {
  const r = await chatsvc.undoSoftDelete(conversationId, messageId);
  if (!r.ok) return toWrite(r);
  remoteCache.delete(conversationId);
  return { ok: true };
}

/**
 * Take files off a sent message: rewrite its properties.files with only the
 * ones to keep. The files stay in the sender's OneDrive, as when Teams itself
 * removes an attachment.
 */
export async function removeFiles(conversationId: string, messageId: string, keep: FileRef[]): Promise<WriteResult> {
  if (keep.some((f) => f.raw === undefined)) return { ok: false, reason: "file data missing" };
  const r = await chatsvc.putMessageProperty(conversationId, messageId, "files", JSON.stringify(keep.map((f) => f.raw)));
  if (!r.ok) return toWrite(r);
  remoteCache.delete(conversationId);
  return { ok: true };
}
