import { useEffect, useRef, useState } from "react";
import { ArrowDown, MessageSquareReply, Paperclip, Reply, Send, X } from "lucide-react";
import { chatTitle } from "../lib/format";
import { useLatest } from "../lib/latest";
import { fileKind, KindIcon } from "../lib/files";
import { extOf } from "../../data/raw";
import { TypingIndicator } from "./TypingIndicator";
import { MessageEditor } from "./MessageEditor";
import type { ComposerState } from "../hooks/useComposerState";
import type { Chat } from "../../types";
import { t } from "../../i18n";

const fmtSize = (n: number) =>
  n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

interface ComposerProps {
  chat: Chat;
  cs: ComposerState;
  atBottom: boolean;
  onScrollToBottom: () => void;
  /** Arrow Up in the empty composer (picks the newest message); true when handled. */
  onUpEmpty?: () => boolean;
}

export function Composer({ chat, cs, atBottom, onScrollToBottom, onUpEmpty }: ComposerProps) {
  const { composer: composerRef, draft, setDraft, quote, setQuote, threadTo, setThreadTo } = cs;
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
    const onOver = (e: DragEvent) => {
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
    const onDrop = (e: DragEvent) => {
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

  const send = () => void cs.send();

  return (
    <div className={"tc-composer" + (dropping ? " dropping" : "")}>
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
      <MessageEditor
        chat={chat}
        value={draft}
        onChange={setDraft}
        inputRef={composerRef}
        picks={cs.picks}
        onPick={cs.addPick}
        onSubmit={send}
        onEscape={() => {
          if (quote) setQuote(null);
          else if (threadTo) setThreadTo(null);
          else return false;
          return true;
        }}
        onUpEmpty={onUpEmpty}
        onFiles={cs.addFiles}
        notifyTyping
        placeholder={
          threadTo && chat.isChannel
            ? t().composer.placeholderThread
            : chat.isChannel
              ? t().composer.placeholderChannel(chatTitle(chat))
              : t().composer.placeholderChat(chatTitle(chat))
        }
        lead={
          <>
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
          </>
        }
        trail={
          <button
            className="tc-send"
            disabled={!draft.trim() && !cs.files.length}
            onClick={send}
            title={t().composer.sendTitle}
            aria-label={t().common.send}
          >
            <Send size={16} />
          </button>
        }
      />
    </div>
  );
}
