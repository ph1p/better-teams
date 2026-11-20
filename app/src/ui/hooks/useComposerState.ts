import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { sendRemote } from "../../teamsData";
import { sendMessage } from "../../send";
import { splitQuote } from "../../quote";
import { typing } from "../../services";
import { oneLine } from "../lib/format";
import type { Flash } from "../lib/toast";
import type { Messages } from "./useMessages";
import type { Chat, Message as Msg, Quote } from "../../types";
import type { MentionPick } from "../../mentions";

// Channel thread the composer answers in.
export interface ThreadTo { rootId: string; from: string; text: string; }

export interface ComposerState {
  composer: RefObject<HTMLTextAreaElement | null>;
  /** Draft of the open chat. */
  draft: string;
  setDraft: (v: string) => void;
  /** Record an inserted @mention for the open chat. */
  addPick: (pick: MentionPick) => void;
  quote: Quote | null;
  setQuote: (q: Quote | null) => void;
  threadTo: ThreadTo | null;
  setThreadTo: (t: ThreadTo | null) => void;
  onQuote: (m: Msg) => void;
  onThreadReply: (m: Msg) => void;
  send: () => Promise<void>;
}

// Why a send failed, in words.
const SEND_ERRORS: Record<string, string> = {
  "chat-not-open": "Teams has no visible row for this chat. Open it once in Teams (⌥⌘T), then retry.",
  "wrong-chat": "Teams switched to another chat. Not sent.",
  "no-composer": "Teams' message box wasn't found. Not sent.",
  "fetch-failed": "Couldn't reach Teams' backend. Not sent.",
  "http-401": "Teams' token expired. Open any chat in Teams to refresh, then retry.",
  "http-403": "Teams' backend refused the send (403). Not sent.",
  "no-token-thread": "Teams isn't ready to send yet. Retry in a moment.",
};

// Per-chat drafts and @mention picks, the quote / thread-reply target, and the
// send itself (optimistic, restored on failure).
export function useComposerState(sel: string | null, selChat: Chat | undefined, m: Messages, flash: Flash): ComposerState {
  const composer = useRef<HTMLTextAreaElement>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // @mention picks for the open chat's draft: the members the user has inserted.
  // Keyed per chat, like drafts. Entries whose `@Name` text is gone are dropped
  // at send time (formatMessage only emits still-present names).
  const [mentionPicks, setMentionPicks] = useState<Record<string, MentionPick[]>>({});
  // A message being quote-replied to, shown as a chip above the composer: null
  // or { id, from, text }. Cleared on send or chat switch.
  const [quote, setQuote] = useState<Quote | null>(null);
  // Channel thread the composer answers in ({ rootId, from, text }), or null
  // for a new top-level post. Cleared on send or chat switch.
  const [threadTo, setThreadTo] = useState<ThreadTo | null>(null);

  useEffect(() => {
    if (!sel) return;
    setQuote(null);
    setThreadTo(null);
  }, [sel, !!selChat?.isChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  const draft = (sel && drafts[sel]) || "";
  const setDraft = (v: string): void => setDrafts((d) => ({ ...d, [sel!]: v }));

  const addPick = (pick: MentionPick): void => {
    setMentionPicks((mp) => {
      const cur = sel ? mp[sel] || [] : [];
      if (cur.some((p) => p.mri === pick.mri)) return mp;
      return sel ? { ...mp, [sel]: [...cur, pick] } : mp;
    });
  };

  // Start a quote-reply: remember the target message and focus the composer.
  const onQuote = useCallback((msg: Msg): void => {
    setQuote({ id: msg.id, from: msg.from || (msg.mine ? "You" : "Unknown"), text: oneLine(splitQuote(msg.content).body).slice(0, 280), time: msg.time, fromMri: msg.fromMri });
    requestAnimationFrame(() => composer.current?.focus());
  }, []);

  // Answer in a channel thread: the composer posts into m's thread until sent
  // or cancelled. Replies target their thread's root.
  const onThreadReply = useCallback((msg: Msg): void => {
    setThreadTo({ rootId: msg.rootId || msg.id, from: msg.from || (msg.mine ? "You" : "Unknown"), text: oneLine(splitQuote(msg.content).body).slice(0, 200) });
    requestAnimationFrame(() => composer.current?.focus());
  }, []);

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text || !selChat) return;
    const chat = selChat;
    const q = quote;
    const thread = chat.isChannel ? threadTo : null;
    const picks = mentionPicks[chat.id] || [];
    const key = Date.now() + Math.random();
    setDrafts((d) => ({ ...d, [chat.id]: "" }));
    typing.resetTyping(chat.id);
    setQuote(null);
    setThreadTo(null);
    setMentionPicks((mp) => ({ ...mp, [chat.id]: [] }));
    m.addPending({ key, chatId: chat.id, text, time: Date.now(), rootId: thread?.rootId });
    m.stickToBottom();
    // Prefer the direct chatsvc endpoint (works for any chat, cached or not).
    // Fall back to driving Teams' native composer only when no token is captured.
    let r = await sendRemote(chat.id, text, q, picks, thread?.rootId);
    if (!r.ok && r.reason === "no-token") r = await sendMessage(chat.id, chat.title, text);
    if (!r.ok) {
      m.dropPending(key);
      setDrafts((d) => ({ ...d, [chat.id]: d[chat.id] || text }));
      setMentionPicks((mp) => ({ ...mp, [chat.id]: picks }));
      if (thread) setThreadTo((t) => t || thread);
      flash(SEND_ERRORS[r.reason] || "Send failed: " + r.reason, 5000);
    }
  }

  return { composer, draft, setDraft, addPick, quote, setQuote, threadTo, setThreadTo, onQuote, onThreadReply, send };
}
