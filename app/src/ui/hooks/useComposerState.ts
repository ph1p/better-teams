import { useCallback, useRef, useState, type RefObject } from "react";
import { useChanged } from "../lib/changed";
import { sendRemote } from "../../teamsData";
import { sendFiles, sendMessage } from "../../send";
import { splitQuote } from "../../quote";
import { typing } from "../../services";
import { oneLine } from "../lib/format";
import { t } from "../../i18n";
import type { Flash } from "../lib/toast";
import type { Messages } from "./useMessages";
import type { Chat, Message as Msg, Quote } from "../../types";
import type { MentionPick } from "../../mentions";

// Channel thread the composer answers in.
export interface ThreadTo {
  rootId: string;
  from: string;
  text: string;
}

export interface ComposerState {
  composer: RefObject<HTMLTextAreaElement | null>;
  /** Draft of the open chat. */
  draft: string;
  setDraft: (v: string) => void;
  /** Record an inserted @mention for the open chat. */
  addPick: (pick: MentionPick) => void;
  /** Files staged for the open chat's next send. */
  files: File[];
  addFiles: (list: FileList | File[]) => void;
  removeFile: (index: number) => void;
  quote: Quote | null;
  setQuote: (q: Quote | null) => void;
  threadTo: ThreadTo | null;
  setThreadTo: (t: ThreadTo | null) => void;
  onQuote: (m: Msg) => void;
  onThreadReply: (m: Msg) => void;
  send: () => Promise<void>;
}

// Per-chat drafts and @mention picks, the quote / thread-reply target, and the
// send itself (optimistic, restored on failure).
export function useComposerState(
  sel: string | null,
  selChat: Chat | undefined,
  m: Messages,
  flash: Flash,
): ComposerState {
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
  // Files staged per chat, like drafts.
  const [staged, setStaged] = useState<Record<string, File[]>>({});

  const switched = useChanged(sel + "|" + !!selChat?.isChannel);
  if (switched && sel) {
    setQuote(null);
    setThreadTo(null);
  }

  const draft = (sel && drafts[sel]) || "";
  const setDraft = (v: string): void => setDrafts((d) => ({ ...d, [sel!]: v }));

  const files = (sel && staged[sel]) || [];
  const addFiles = (list: FileList | File[]): void => {
    const add = [...list];
    if (sel && add.length) setStaged((st) => ({ ...st, [sel]: [...(st[sel] || []), ...add] }));
  };
  const removeFile = (index: number): void => {
    if (sel) setStaged((st) => ({ ...st, [sel]: (st[sel] || []).filter((_, i) => i !== index) }));
  };

  const addPick = (pick: MentionPick): void => {
    setMentionPicks((mp) => {
      const cur = sel ? mp[sel] || [] : [];
      if (cur.some((p) => p.mri === pick.mri)) return mp;
      return sel ? { ...mp, [sel]: [...cur, pick] } : mp;
    });
  };

  // Start a quote-reply: remember the target message and focus the composer.
  const onQuote = useCallback((msg: Msg): void => {
    setQuote({
      id: msg.id,
      from: msg.from || (msg.mine ? t().common.you : t().common.unknown),
      text: oneLine(splitQuote(msg.content).body).slice(0, 280),
      time: msg.time,
      fromMri: msg.fromMri,
    });
    requestAnimationFrame(() => composer.current?.focus());
  }, []);

  // Answer in a channel thread: the composer posts into m's thread until sent
  // or cancelled. Replies target their thread's root.
  const onThreadReply = useCallback((msg: Msg): void => {
    setThreadTo({
      rootId: msg.rootId || msg.id,
      from: msg.from || (msg.mine ? t().common.you : t().common.unknown),
      text: oneLine(splitQuote(msg.content).body).slice(0, 200),
    });
    requestAnimationFrame(() => composer.current?.focus());
  }, []);

  async function send(): Promise<void> {
    const text = draft.trim();
    if ((!text && !files.length) || !selChat) return;
    const chat = selChat;
    const q = quote;
    const thread = chat.isChannel ? threadTo : null;
    const sending = files;
    // Files go through Teams' own composer, which has no quote or thread target.
    if (sending.length && (q || thread)) {
      flash(t().composer.filesWithQuote, 5000);
      return;
    }
    const picks = mentionPicks[chat.id] || [];
    const key = Date.now() + Math.random();
    setDrafts((d) => ({ ...d, [chat.id]: "" }));
    typing.resetTyping(chat.id);
    setQuote(null);
    setThreadTo(null);
    setMentionPicks((mp) => ({ ...mp, [chat.id]: [] }));
    setStaged((st) => ({ ...st, [chat.id]: [] }));
    m.addPending({
      key,
      chatId: chat.id,
      text,
      time: Date.now(),
      rootId: thread?.rootId,
      files: sending.map((f) => f.name),
    });
    m.stickToBottom();
    // Prefer the direct chatsvc endpoint (works for any chat, cached or not).
    // Fall back to driving Teams' native composer only when no token is captured.
    let r = sending.length
      ? await sendFiles(chat.id, chat.title, text, sending)
      : await sendRemote(chat.id, text, q, picks, thread?.rootId);
    if (!r.ok && r.reason === "no-token") r = await sendMessage(chat.id, chat.title, text);
    if (!r.ok) {
      m.dropPending(key);
      setDrafts((d) => ({ ...d, [chat.id]: d[chat.id] || text }));
      setMentionPicks((mp) => ({ ...mp, [chat.id]: picks }));
      setStaged((st) => ({ ...st, [chat.id]: [...sending, ...(st[chat.id] || [])] }));
      if (thread) setThreadTo((t) => t || thread);
      // Why a send failed, in words; unknown reasons show as-is.
      const known = t().composer.sendErrors;
      flash(r.reason in known ? known[r.reason as keyof typeof known] : t().composer.sendFailed(r.reason), 5000);
    }
  }

  return {
    composer,
    draft,
    setDraft,
    addPick,
    files,
    addFiles,
    removeFile,
    quote,
    setQuote,
    threadTo,
    setThreadTo,
    onQuote,
    onThreadReply,
    send,
  };
}
