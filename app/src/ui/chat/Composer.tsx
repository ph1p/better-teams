import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import { ArrowDown, MessageSquareReply, Paperclip, Reply, Send, Smile, SquareCode, X } from "lucide-react";
import { myMri, profile, searchPeople } from "../../teamsData";
import { typing } from "../../services";
import { EmojiPicker } from "../shared/EmojiPicker";
import { Avatar } from "../shared/Avatar";
import { avatarUri, chatTitle } from "../lib/format";
import { useDismiss } from "../lib/dismiss";
import { useLatest } from "../lib/latest";
import { useChanged } from "../lib/changed";
import { codeBlock, handleFormatKey } from "../lib/editKeys";
import { fileKind, KindIcon } from "../lib/files";
import { extOf } from "../../data/raw";
import { TypingIndicator } from "./TypingIndicator";
import type { ComposerState } from "../hooks/useComposerState";
import type { Chat } from "../../types";
import type { MentionPick } from "../../mentions";
import { t } from "../../i18n";

const fmtSize = (n: number): string =>
  n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";

const NO_PICKS: MentionPick[] = [];
const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

interface ComposerProps {
  chat: Chat;
  cs: ComposerState;
  /** Message list scrolled near the bottom (hides the jump button). */
  atBottom: boolean;
  onScrollToBottom: () => void;
}

// The message box of the open chat: typing indicator, thread / quote chips,
// emoji picker, @mention autocomplete (chat members + org directory) and
// markdown-lite formatting (see src/markdown.ts, ui/lib/editKeys.ts), and
// files staged to send (attach button, paste, or drop on the composer).
export function Composer({ chat, cs, atBottom, onScrollToBottom }: ComposerProps): JSX.Element {
  const { composer: composerRef, draft, setDraft, quote, setQuote, threadTo, setThreadTo } = cs;
  // @-autocomplete popup: open flag + current filter query (text after the @).
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  // Org-directory @mention hits (debounced searchPeople), merged after local members.
  // Kept with the query they answer; shown only while that query is current.
  const [org, setOrg] = useState<{ q: string; hits: MentionPick[] }>({ q: "", hits: NO_PICKS });
  const atOrg = atOpen && org.q === atQuery.trim() ? org.hits : NO_PICKS;
  const [emojiOpen, setEmojiOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  // Files dropped anywhere on the chat pane get staged. Caught on window in
  // the capture phase so Teams' own drop handlers (which would upload into the
  // hidden native composer) never see it, and a drop elsewhere on the overlay
  // doesn't make the browser open the file.
  const addFiles = useLatest(cs.addFiles);
  useEffect(() => {
    let clear = 0;
    const where = (e: DragEvent): "pane" | "overlay" | null => {
      const t = e.target instanceof Element ? e.target : null;
      return t?.closest("#tc-root .tc-main") ? "pane" : t?.closest("#tc-root") ? "overlay" : null;
    };
    const onOver = (e: DragEvent): void => {
      const w = where(e);
      if (!w || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = w === "pane" ? "copy" : "none";
      setDropping(w === "pane");
      // dragover repeats while over the window; once it stops, the drag left.
      clearTimeout(clear);
      clear = window.setTimeout(() => setDropping(false), 150);
    };
    const onDrop = (e: DragEvent): void => {
      const w = where(e);
      if (!w || !hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(clear);
      setDropping(false);
      if (w !== "pane" || !e.dataTransfer!.files.length) return;
      addFiles.current(e.dataTransfer!.files);
      composerRef.current?.focus();
    };
    window.addEventListener("dragenter", onOver, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      clearTimeout(clear);
      window.removeEventListener("dragenter", onOver, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [addFiles, composerRef]);

  // Insert text at the composer's caret (or append), keeping focus and caret.
  const insertAtCaret = (ins: string): void => {
    const el = composerRef.current;
    if (!el) {
      setDraft(draft + ins);
      return;
    }
    const s = el.selectionStart ?? draft.length;
    const e = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, s) + ins + draft.slice(e);
    setDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + ins.length;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
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
    const el = composerRef.current;
    const caret = el?.selectionStart ?? v.length;
    // Match "@" preceded by start/space, up to the caret, name chars only.
    const upto = v.slice(0, caret);
    const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(upto);
    if (m) {
      setAtQuery(m[1]);
      setAtOpen(true);
    } else {
      setAtOpen(false);
      setAtQuery("");
    }
  };

  // Replace the half-typed "@query" at the caret with "@Display Name " and record
  // the pick so the send path can emit a real mention span.
  const pickMention = (pick: MentionPick): void => {
    const el = composerRef.current;
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
    requestAnimationFrame(() => {
      el?.focus();
      const pos = start + insert.length;
      try {
        el?.setSelectionRange(pos, pos);
      } catch {
        /* ignore */
      }
    });
  };

  // Close the @-picker and the emoji picker when the open chat changes.
  if (useChanged(chat.id)) {
    setAtOpen(false);
    setAtQuery("");
    setEmojiOpen(false);
  }

  // Debounced org-directory search while the @-picker is open. Local chat members
  // show instantly; org hits stream in ~250ms after typing stops. Stale responses
  // are dropped via the `live` guard so an older query can't overwrite a newer one.
  useEffect(() => {
    const q = atQuery.trim();
    if (!atOpen || q.length < 2) return;
    let live = true;
    const h = setTimeout(() => {
      searchPeople(q, 8)
        .then((hits) => {
          if (!live) return;
          setOrg({ q, hits: hits.map((p) => ({ mri: p.mri, name: p.displayName, mentionType: "person" })) });
        })
        .catch(() => {
          /* keep local-only candidates */
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [atOpen, atQuery]);

  // Auto-grow the composer.
  useLayoutEffect(() => {
    const el = composerRef.current;
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
    <div className={"tc-composer" + (dropping ? " dropping" : "")}>
      {/* Floats above the box so typing never shifts the layout. */}
      {chat.isChannel ? null : <TypingIndicator chatId={chat.id} />}
      {!atBottom ? (
        <button
          className="tc-scroll-newest"
          onClick={onScrollToBottom}
          title={t().composer.jumpToNewest}
          aria-label={t().composer.jumpToNewest}
        >
          <ArrowDown size={16} />
        </button>
      ) : null}
      {threadTo && chat.isChannel ? (
        <div className="tc-quote-chip tc-thread-chip">
          <MessageSquareReply size={13} className="tc-quote-chip-icon" />
          <div className="tc-quote-chip-body">
            <span className="tc-quote-chip-from">{t().composer.replyInThread(threadTo.from)}</span>
            <span className="tc-quote-chip-text">{threadTo.text || "…"}</span>
          </div>
          <button
            className="tc-quote-chip-x"
            onClick={() => setThreadTo(null)}
            title={t().composer.postAsNew}
            aria-label={t().composer.cancelThreadReply}
          >
            <X size={13} />
          </button>
        </div>
      ) : null}
      {quote ? (
        <div className="tc-quote-chip">
          <Reply size={13} className="tc-quote-chip-icon" />
          <div className="tc-quote-chip-body">
            <span className="tc-quote-chip-from">{quote.from}</span>
            <span className="tc-quote-chip-text">{quote.text || "…"}</span>
          </div>
          <button className="tc-quote-chip-x" onClick={() => setQuote(null)} aria-label={t().composer.cancelQuote}>
            <X size={13} />
          </button>
        </div>
      ) : null}
      {emojiOpen ? (
        <div className="tc-emoji-pop" onMouseDown={(e) => e.stopPropagation()}>
          <EmojiPicker
            onPick={(em) => {
              insertAtCaret(em);
              setEmojiOpen(false);
            }}
          />
        </div>
      ) : null}
      {atOpen && atCandidates.length ? (
        <div className="tc-at-pop" onMouseDown={(e) => e.stopPropagation()}>
          {atCandidates.map((c) => (
            <button key={c.mri} className="tc-at-opt" onClick={() => pickMention(c)}>
              <Avatar name={c.name} uri={avatarUri(c.mri)} mri={c.mri} small />
              <span className="tc-at-name">{c.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {cs.files.length ? (
        <div className="tc-staged">
          {cs.files.map((f, i) => (
            <div key={i + f.name} className="tc-card">
              <span className="tc-card-main">
                <KindIcon kind={fileKind(extOf(f.name))} className="tc-card-icon" size={18} />
                <span className="tc-card-text">
                  <span className="tc-card-name" title={f.name}>
                    {f.name}
                  </span>
                  <span className="tc-card-ext">{fmtSize(f.size)}</span>
                </span>
              </span>
              <button
                className="tc-quote-chip-x"
                onClick={() => cs.removeFile(i)}
                title={t().common.remove}
                aria-label={t().common.removeNamed(f.name)}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="tc-composer-box">
        <button
          className="tc-emoji-btn"
          onClick={() => fileInput.current?.click()}
          title={t().composer.attachTitle}
          aria-label={t().composer.attach}
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) cs.addFiles(e.target.files);
            e.target.value = "";
            composerRef.current?.focus();
          }}
        />
        <button
          className="tc-emoji-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setEmojiOpen((o) => !o)}
          title={t().composer.emoji}
          aria-label={t().composer.emoji}
          aria-expanded={emojiOpen}
        >
          <Smile size={18} />
        </button>
        <button
          className="tc-emoji-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (composerRef.current) codeBlock(composerRef.current);
          }}
          title={t().composer.codeBlockTitle}
          aria-label={t().composer.insertCodeBlock}
        >
          <SquareCode size={18} />
        </button>
        <textarea
          ref={composerRef}
          rows={1}
          placeholder={
            threadTo && chat.isChannel
              ? t().composer.placeholderThread
              : chat.isChannel
                ? t().composer.placeholderChannel(chatTitle(chat))
                : t().composer.placeholderChat(chatTitle(chat))
          }
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onPaste={(e) => {
            if (!e.clipboardData.files.length) return;
            e.preventDefault();
            cs.addFiles(e.clipboardData.files);
          }}
          onKeyDown={(e) => {
            if (atOpen && atCandidates.length) {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                pickMention(atCandidates[0]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setAtOpen(false);
                return;
              }
            }
            if (handleFormatKey(e)) return;
            if (e.key === "Escape" && (threadTo || quote)) {
              e.preventDefault();
              if (quote) setQuote(null);
              else setThreadTo(null);
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
          disabled={!draft.trim() && !cs.files.length}
          onClick={send}
          title={t().composer.sendTitle}
          aria-label={t().common.send}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
