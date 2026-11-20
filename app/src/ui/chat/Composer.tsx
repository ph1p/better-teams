import { useEffect, useLayoutEffect, useMemo, useState, type JSX } from "react";
import { ArrowDown, MessageSquareReply, Reply, Send, Smile, SquareCode, X } from "lucide-react";
import { myMri, profile, searchPeople } from "../../teamsData";
import { typing } from "../../services";
import { EmojiPicker } from "../shared/EmojiPicker";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { useDismiss } from "../lib/dismiss";
import { codeBlock, handleFormatKey } from "../lib/editKeys";
import { TypingIndicator } from "./TypingIndicator";
import type { ComposerState } from "../hooks/useComposerState";
import type { Chat } from "../../types";
import type { MentionPick } from "../../mentions";

interface ComposerProps {
  chat: Chat;
  cs: ComposerState;
  /** Message list scrolled near the bottom (hides the jump button). */
  atBottom: boolean;
  onScrollToBottom: () => void;
}

// The message box of the open chat: typing indicator, thread / quote chips,
// emoji picker, @mention autocomplete (chat members + org directory) and
// markdown-lite formatting (see src/markdown.ts, ui/lib/editKeys.ts).
export function Composer({ chat, cs, atBottom, onScrollToBottom }: ComposerProps): JSX.Element {
  const { composer, draft, setDraft, quote, setQuote, threadTo, setThreadTo } = cs;
  // @-autocomplete popup: open flag + current filter query (text after the @).
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  // Org-directory @mention hits (debounced searchPeople), merged after local members.
  const [atOrg, setAtOrg] = useState<MentionPick[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Insert text at the composer's caret (or append), keeping focus and caret.
  const insertAtCaret = (ins: string): void => {
    const el = composer.current;
    if (!el) { setDraft(draft + ins); return; }
    const s = el.selectionStart ?? draft.length;
    const e = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, s) + ins + draft.slice(e);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + ins.length;
      try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  };

  // Resolved, filtered @mention candidates for the open chat: its members (minus
  // me) whose display name matches the text typed after the "@".
  const myself = myMri();
  const atCandidates = useMemo<MentionPick[]>(() => {
    const q = atQuery.trim().toLowerCase();
    const seen = new Set<string>();
    const out: MentionPick[] = [];
    for (const mri of chat.members) {
      if (!mri || mri === myself || seen.has(mri)) continue;
      seen.add(mri);
      const name = profile(mri).displayName || "";
      if (!name) continue;
      if (q && !name.toLowerCase().includes(q)) continue;
      out.push({ mri, name, mentionType: "person" });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    // Append org-directory hits (anyone, not just chat members), deduped by mri.
    for (const p of atOrg) {
      if (!p.mri || p.mri === myself || seen.has(p.mri)) continue;
      seen.add(p.mri);
      out.push(p);
    }
    return out.slice(0, 8);
  }, [chat, atQuery, myself, atOrg]);

  // Watch the draft for an "@word" the caret sits at the end of; open the picker
  // and track the query. Any other edit closes it.
  const onDraftChange = (v: string): void => {
    setDraft(v);
    // Teams signals typing on every non-empty editor change (throttled per chat).
    if (v.trim()) typing.notifyTyping({ convId: chat.id, isChannel: chat.isChannel, members: chat.members });
    const el = composer.current;
    const caret = el?.selectionStart ?? v.length;
    // Match "@" preceded by start/space, up to the caret, name chars only.
    const upto = v.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(upto);
    if (m) { setAtQuery(m[1]); setAtOpen(true); }
    else { setAtOpen(false); setAtQuery(""); }
  };

  // Replace the half-typed "@query" at the caret with "@Display Name " and record
  // the pick so the send path can emit a real mention span.
  const pickMention = (pick: MentionPick): void => {
    const el = composer.current;
    const caret = el?.selectionStart ?? draft.length;
    const upto = draft.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(upto);
    const start = m ? caret - m[1].length - 1 : caret; // back over "@query"
    const insert = "@" + pick.name + " ";
    const next = draft.slice(0, start) + insert + draft.slice(caret);
    setDraft(next);
    cs.addPick(pick);
    setAtOpen(false);
    setAtQuery("");
    setAtOrg([]);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + insert.length;
      try { el?.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  };

  // Close the @-picker and the emoji picker when the open chat changes.
  useEffect(() => { setAtOpen(false); setAtQuery(""); setAtOrg([]); }, [chat.id]);
  useEffect(() => { setEmojiOpen(false); }, [chat.id]);

  // Debounced org-directory search while the @-picker is open. Local chat members
  // show instantly; org hits stream in ~250ms after typing stops. Stale responses
  // are dropped via the `live` guard so an older query can't overwrite a newer one.
  useEffect(() => {
    if (!atOpen) { setAtOrg([]); return; }
    const q = atQuery.trim();
    if (q.length < 2) { setAtOrg([]); return; }
    let live = true;
    const h = setTimeout(() => {
      searchPeople(q, 8)
        .then((hits) => {
          if (!live) return;
          setAtOrg(hits.map((p) => ({ mri: p.mri, name: p.displayName, mentionType: "person" })));
        })
        .catch(() => { /* keep local-only candidates */ });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [atOpen, atQuery]);

  // Auto-grow the composer.
  useLayoutEffect(() => {
    const el = composer.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [draft, chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the emoji picker on any outside click, scroll, Escape, or resize; the
  // picker and its toggle button count as inside.
  useDismiss(emojiOpen, "#tc-root .tc-emoji-pop, #tc-root .tc-emoji-btn", () => setEmojiOpen(false));

  const send = (): void => {
    if (draft.trim()) setAtOpen(false);
    void cs.send();
  };

  return (
    <div className="tc-composer">
      {/* Floats above the box so typing never shifts the layout. */}
      {chat.isChannel ? null : <TypingIndicator chatId={chat.id} />}
      {!atBottom ? (
        <button className="tc-scroll-newest" onClick={onScrollToBottom} title="Jump to newest" aria-label="Jump to newest">
          <ArrowDown size={16} />
        </button>
      ) : null}
      {threadTo && chat.isChannel ? (
        <div className="tc-quote-chip tc-thread-chip">
          <MessageSquareReply size={13} className="tc-quote-chip-icon" />
          <div className="tc-quote-chip-body">
            <span className="tc-quote-chip-from">Reply in thread · {threadTo.from}</span>
            <span className="tc-quote-chip-text">{threadTo.text || "…"}</span>
          </div>
          <button className="tc-quote-chip-x" onClick={() => setThreadTo(null)} title="Post as new conversation (Esc)" aria-label="Cancel thread reply"><X size={13} /></button>
        </div>
      ) : null}
      {quote ? (
        <div className="tc-quote-chip">
          <Reply size={13} className="tc-quote-chip-icon" />
          <div className="tc-quote-chip-body">
            <span className="tc-quote-chip-from">{quote.from}</span>
            <span className="tc-quote-chip-text">{quote.text || "…"}</span>
          </div>
          <button className="tc-quote-chip-x" onClick={() => setQuote(null)} aria-label="Cancel quote"><X size={13} /></button>
        </div>
      ) : null}
      {emojiOpen ? (
        <div className="tc-emoji-pop" onMouseDown={(e) => e.stopPropagation()}>
          <EmojiPicker onPick={(em) => { insertAtCaret(em); setEmojiOpen(false); }} />
        </div>
      ) : null}
      {atOpen && atCandidates.length ? (
        <div className="tc-at-pop" onMouseDown={(e) => e.stopPropagation()}>
          {atCandidates.map((c) => (
            <button
              key={c.mri}
              className="tc-at-opt"
              onClick={() => pickMention(c)}
            >
              <Avatar name={c.name} uri={avatarUri(c.mri)} mri={c.mri} small />
              <span className="tc-at-name">{c.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="tc-composer-box">
        <button
          className="tc-emoji-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setEmojiOpen((o) => !o)}
          title="Emoji"
          aria-label="Emoji"
          aria-expanded={emojiOpen}
        >
          <Smile size={18} />
        </button>
        <button
          className="tc-emoji-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { if (composer.current) codeBlock(composer.current); }}
          title={"Code block (\u2318\u21e7C)\n**bold** \u2318B · *italic* \u2318I · `code` \u2318E · ~~strike~~ \u2318\u21e7X\n```lang for highlighted code · - lists · > quotes"}
          aria-label="Insert code block"
        >
          <SquareCode size={18} />
        </button>
        <textarea
          ref={composer}
          rows={1}
          placeholder={threadTo && chat.isChannel ? "Reply in thread…" : chat.isChannel ? "Start a new post in #" + chat.title : "Message " + chat.title}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (atOpen && atCandidates.length) {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                pickMention(atCandidates[0]);
                return;
              }
              if (e.key === "Escape") { e.preventDefault(); setAtOpen(false); return; }
            }
            if (handleFormatKey(e)) return;
            if (e.key === "Escape" && (threadTo || quote)) {
              e.preventDefault();
              if (quote) setQuote(null); else setThreadTo(null);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          className="tc-send"
          disabled={!draft.trim()}
          onClick={send}
          title="Send (Enter) · Shift+Enter for a new line"
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
