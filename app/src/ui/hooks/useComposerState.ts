import { useCallback, useRef, useState, type RefObject } from "react";
import { useChanged } from "../lib/changed";
import { sendRemote } from "../../teamsData";
import { sendFiles, sendMessage } from "../../send";
import { splitQuote } from "../../quote";
import { typing } from "../../services";
import { oneLine } from "../lib/format";
import { nativeFallbackBlocker } from "../lib/sendFallback";
import { t } from "../../i18n";
import type { Flash } from "../lib/toast";
import type { Messages } from "./useMessages";
import type { Chat, Message as Msg, Quote } from "../../types";
import type { MentionPick } from "../../mentions";

const NO_PICKS: readonly MentionPick[] = [];

export interface ComposerState {
  composer: RefObject<HTMLTextAreaElement | null>;
  /** Draft of the open chat. */
  draft: string;
  setDraft: (v: string) => void;
  /** Record an inserted @mention for the open chat. */
  addPick: (pick: MentionPick) => void;
  /** @mentions inserted into the open chat's draft. */
  picks: readonly MentionPick[];
  /** Files staged for the open chat's next send. */
  files: File[];
  addFiles: (list: FileList | File[]) => void;
  removeFile: (index: number) => void;
  quote: Quote | null;
  setQuote: (q: Quote | null) => void;
  /** Channel thread root this composer answers in (thread pane), else null. */
  threadRoot: string | null;
  onQuote: (m: Msg) => void;
  send: () => Promise<void>;
}

// Per-chat drafts and @mention picks, the quote target, and the send itself
// (optimistic, restored on failure). With a threadRoot it backs the thread
// pane's composer: drafts are kept per thread and sends go into that thread.
export function useComposerState(
  sel: string | null,
  selChat: Chat | undefined,
  m: Messages,
  flash: Flash,
  threadRoot: string | null = null,
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
  // Files staged per chat, like drafts.
  const [staged, setStaged] = useState<Record<string, File[]>>({});

  // Drafts, picks and files are keyed per chat, or per chat + thread.
  const key = sel && threadRoot ? sel + "#" + threadRoot : sel;
  const switched = useChanged(key + "|" + !!selChat?.isChannel);
  if (switched && key) setQuote(null);

  const draft = (key && drafts[key]) || "";
  const setDraft = (v: string) => setDrafts((d) => ({ ...d, [key!]: v }));

  const files = (key && staged[key]) || [];
  const addFiles = (list: FileList | File[]) => {
    const add = [...list];
    if (key && add.length) setStaged((st) => ({ ...st, [key]: [...(st[key] || []), ...add] }));
  };
  const removeFile = (index: number) => {
    if (key) setStaged((st) => ({ ...st, [key]: (st[key] || []).filter((_, i) => i !== index) }));
  };

  const addPick = (pick: MentionPick) => {
    setMentionPicks((mp) => {
      const cur = key ? mp[key] || [] : [];
      if (cur.some((p) => p.mri === pick.mri)) return mp;
      return key ? { ...mp, [key]: [...cur, pick] } : mp;
    });
  };

  // Start a quote-reply: remember the target message and focus the composer.
  const onQuote = useCallback((msg: Msg) => {
    setQuote({
      id: msg.id,
      from: msg.from || (msg.mine ? t().common.you : t().common.unknown),
      text: oneLine(splitQuote(msg.content).body).slice(0, 280),
      time: msg.time,
      fromMri: msg.fromMri,
    });
    requestAnimationFrame(() => composer.current?.focus());
  }, []);

  async function send() {
    const text = draft.trim();
    if ((!text && !files.length) || !selChat || !key) return;
    const chat = selChat;
    const q = quote;
    const rootId = threadRoot ?? undefined;
    const sending = files;
    // Files go through Teams' own composer, which has no quote or thread target.
    if (sending.length && (q || rootId)) {
      flash(t().composer.filesWithQuote, 5000);
      return;
    }
    const picks = mentionPicks[key] || [];
    const pendingKey = Date.now() + Math.random();
    setDrafts((d) => ({ ...d, [key]: "" }));
    typing.resetTyping(chat.id);
    setQuote(null);
    setMentionPicks((mp) => ({ ...mp, [key]: [] }));
    setStaged((st) => ({ ...st, [key]: [] }));
    m.addPending({
      key: pendingKey,
      chatId: chat.id,
      text,
      time: Date.now(),
      rootId,
      files: sending.map((f) => f.name),
    });
    // A thread reply shows in the thread pane; the channel stays where it is.
    if (!rootId) m.stickToBottom();
    // Prefer the direct chatsvc endpoint (works for any chat, cached or not).
    // Fall back to driving Teams' native composer only when no token is captured.
    let r = sending.length
      ? await sendFiles(chat.id, chat.title, text, sending)
      : await sendRemote(chat.id, text, q, picks, rootId);
    if (!r.ok && r.reason === "no-token") {
      const blocked = nativeFallbackBlocker(q, picks);
      r = blocked ? { ok: false, reason: blocked } : await sendMessage(chat.id, chat.title, text);
    }
    if (!r.ok) {
      m.dropPending(pendingKey);
      setDrafts((d) => ({ ...d, [key]: d[key] || text }));
      setMentionPicks((mp) => ({ ...mp, [key]: picks }));
      setStaged((st) => ({ ...st, [key]: [...sending, ...(st[key] || [])] }));
      if (q) setQuote((cur) => cur || q);
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
    picks: (key && mentionPicks[key]) || NO_PICKS,
    files,
    addFiles,
    removeFile,
    quote,
    setQuote,
    threadRoot,
    onQuote,
    send,
  };
}
