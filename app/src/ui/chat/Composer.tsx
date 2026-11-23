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
import { codeBlock, handleFormatKey, replaceText } from "../lib/editKeys";
import { highlightDraft, mentionRe, type Seg } from "../lib/draftHighlight";
import { searchShortcodes, shortcodeGlyph } from "../lib/reactions";
import { inOpenFence } from "../../markdown";
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

// ":name" being typed before the caret, and a finished ":name:" (auto-replaced).
const AT_Q = /(?:^|\s)@([^\s@]{0,40})$/;
const EMOJI_Q = /(?:^|[\s(]):([a-z0-9_+-]{2,30})$/i;
const EMOJI_DONE = /(?:^|[\s(]):([a-z0-9_+-]{2,30}):$/i;
// Keeps the arrow-selected popup row visible.
const scrollNear = (el: HTMLElement | null): void => el?.scrollIntoView({ block: "nearest" });
// The end-anchored popup regexes only need the text just before the caret.
const tail = (upto: string): string => upto.slice(-48);
// Caret inside a code fence or an open `code span` on its line: no emoji there.
const inCode = (upto: string): boolean =>
  inOpenFence(upto) || upto.slice(upto.lastIndexOf("\n") + 1).split("`").length % 2 === 0;

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
  // ":smi" emoji autocomplete: the query after the colon, or null when closed.
  const [emQuery, setEmQuery] = useState<string | null>(null);
  const emHits = useMemo(() => (emQuery ? searchShortcodes(emQuery) : []), [emQuery]);
  // Highlighted row of whichever popup is open (arrow keys move it).
  const [active, setActive] = useState(0);
  const hlRef = useRef<HTMLDivElement>(null);
  const atRe = useMemo(() => mentionRe(cs.picks.map((p) => p.name)), [cs.picks]);
  const hl = useMemo(() => renderSegs(highlightDraft(draft, atRe)), [draft, atRe]);
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
    splice(el.selectionStart ?? draft.length, el.selectionEnd ?? draft.length, ins);
  };

  // Replace [start, end) of the textarea with `ins`, caret after it. Goes
  // through the native edit path, so Cmd+Z undoes it; onChange then syncs the draft.
  const splice = (start: number, end: number, ins: string): void => {
    const el = composerRef.current;
    if (el) replaceText(el, start, end, ins);
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
    const end = tail(upto);
    const m = AT_Q.exec(end);
    if (m) {
      setAtQuery(m[1]);
      setAtOpen(true);
    } else {
      setAtOpen(false);
      setAtQuery("");
    }
    setActive(0);
    // A finished ":name:" becomes its emoji, like Slack (never inside code).
    const done = EMOJI_DONE.exec(end);
    const glyph = done && shortcodeGlyph(done[1]);
    if (glyph && done && !inCode(upto)) {
      setEmQuery(null);
      splice(caret - done[1].length - 2, caret, glyph);
      return;
    }
    const em = m ? null : EMOJI_Q.exec(end);
    setEmQuery(em && !inCode(upto) ? em[1] : null);
  };

  // Replace the half-typed ":query" at the caret with the emoji.
  const pickEmoji = (glyph: string): void => {
    const caret = composerRef.current?.selectionStart ?? draft.length;
    const em = EMOJI_Q.exec(tail(draft.slice(0, caret)));
    setEmQuery(null);
    splice(em ? caret - em[1].length - 1 : caret, caret, glyph);
  };

  // Replace the half-typed "@query" at the caret with "@Display Name " and record
  // the pick so the send path can emit a real mention span.
  const pickMention = (pick: MentionPick): void => {
    const el = composerRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const m = AT_Q.exec(tail(draft.slice(0, caret)));
    const start = m ? caret - m[1].length - 1 : caret; // back over "@query"
    cs.addPick(pick);
    setAtOpen(false);
    setAtQuery("");
    splice(start, caret, "@" + pick.name + " ");
  };

  // The open popup (@mention wins over :emoji): row count, pick, close.
  const pop: "at" | "em" | null = atOpen && atCandidates.length ? "at" : emHits.length ? "em" : null;
  const popN = pop === "at" ? atCandidates.length : emHits.length;
  const on = pop ? Math.min(active, popN - 1) : 0;
  const popPick = (i: number) => (pop === "at" ? pickMention(atCandidates[i]) : pickEmoji(emHits[i].glyph));
  const popClose = () => (pop === "at" ? setAtOpen(false) : setEmQuery(null));
  const optProps = (i: number) => ({
    className: "tc-at-opt" + (i === on ? " on" : ""),
    ref: i === on ? scrollNear : undefined,
    onMouseEnter: () => setActive(i),
    onClick: () => popPick(i),
  });

  // Close the @-picker and the emoji picker when the open chat changes.
  if (useChanged(chat.id)) {
    setAtOpen(false);
    setAtQuery("");
    setEmojiOpen(false);
    setEmQuery(null);
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
    if (hlRef.current) hlRef.current.scrollTop = el.scrollTop;
  }, [draft, chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the emoji picker on any outside click, scroll, Escape, or resize; the
  // picker and its toggle button count as inside.
  useDismiss(emojiOpen, "#tc-root .tc-emoji-pop, #tc-root .tc-emoji-btn", () => setEmojiOpen(false));

  const send = (): void => {
    if (draft.trim()) setAtOpen(false);
    setEmQuery(null);
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
          {atCandidates.map((c, i) => (
            <button key={c.mri} {...optProps(i)}>
              <Avatar name={c.name} uri={avatarUri(c.mri)} mri={c.mri} small />
              <span className="tc-at-name">{c.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {pop === "em" ? (
        <div className="tc-at-pop tc-em-pop" onMouseDown={(e) => e.preventDefault()}>
          {emHits.map((h, i) => (
            <button key={h.name} {...optProps(i)}>
              <span className="tc-em-glyph">{h.glyph}</span>
              <span className="tc-at-name">:{h.name}:</span>
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
        <div className="tc-composer-field">
          {/* Styled copy of the draft behind the (transparent-text) textarea. */}
          <div className="tc-composer-hl" ref={hlRef} aria-hidden>
            {hl}
          </div>
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
            onScroll={(e) => {
              if (hlRef.current) hlRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onSelect={(e) => {
              // Moving the caret away from a ":query" closes its popup.
              if (emQuery === null) return;
              const el = e.currentTarget;
              if (!EMOJI_Q.test(tail(el.value.slice(0, el.selectionStart)))) setEmQuery(null);
            }}
            onPaste={(e) => {
              if (!e.clipboardData.files.length) return;
              e.preventDefault();
              cs.addFiles(e.clipboardData.files);
            }}
            onKeyDown={(e) => {
              // Open @mention or :emoji popup: arrows move, Enter / Tab pick, Escape closes.
              if (pop) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((on + (e.key === "ArrowDown" ? 1 : popN - 1)) % popN);
                  return;
                }
                if ((e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === "Tab") {
                  e.preventDefault();
                  popPick(on);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  popClose();
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
        </div>
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

// Backdrop segments → React nodes (no innerHTML: Teams enforces Trusted Types).
function renderSegs(segs: Seg[]): (string | JSX.Element)[] {
  return segs.map((s, i) =>
    typeof s === "string" ? (
      s
    ) : (
      <span key={i} className={s.cls}>
        {renderSegs(s.kids)}
      </span>
    ),
  );
}
