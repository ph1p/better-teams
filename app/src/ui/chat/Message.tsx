import { memo, useEffect, useRef, useState, type JSX } from "react";
import { t } from "../../i18n";
import { personName, useNameFormat } from "../../names";
import { profile } from "../../teamsData";
import { SmilePlus, Pencil, Trash2, Undo2, X, Reply, Copy, Check, MessageSquareReply } from "lucide-react";
import { splitQuote } from "../../quote";
import { RichHtml } from "../../richText";
import { Avatar } from "../shared/Avatar";
import { Attachments } from "./Attachments";
import { Cards } from "./Cards";
import { isAppMri } from "../../apps";
import { Linkified } from "../shared/Linkified";
import { avatarUri, fmtClock, fmtFull, htmlToText, isHtmlMsg, messageText, oneLine } from "../lib/format";
import { handleFormatKey } from "../lib/editKeys";
import { htmlToMarkdown } from "../lib/htmlToMarkdown";
import { usePresence } from "../lib/presence";
import { glyphFor, PICKER } from "../lib/reactions";
import { imageItem, openViewer } from "../lib/files";
import { useCopied } from "../lib/clipboard";
import type { Message as Msg } from "../../types";

interface MessageProps {
  m: Msg;
  first: boolean;
  channel: boolean;
  cid: string;
  onReact: (cid: string, messageId: string, key: string, add: boolean) => void;
  onDelete: (cid: string, messageId: string) => void;
  onRemoveFile: (cid: string, messageId: string, index: number) => void;
  onUndo: (cid: string, messageId: string) => void;
  onEdit: (cid: string, messageId: string, text: string, quoteHtml: string) => void;
  onOpenProfile: (mri: string) => void;
  onQuote: (m: Msg) => void;
  onJumpTo?: (mid: string) => void;
  /** Channels only: answer in this message's thread. */
  onThreadReply?: (m: Msg) => void;
  /** Card buttons that post back to a bot hand off to Teams. */
  onOpenInTeams?: () => void;
}

// One rendered message: avatar + meta on the first of a group, content (rich
// HTML or linkified text), files, reactions, and a hover toolbar (react / quote
// / edit / delete). Edit swaps the content for a textarea with a quote chip.
export const Message = memo(function Message({
  m,
  first,
  channel,
  cid,
  onReact,
  onDelete,
  onRemoveFile,
  onUndo,
  onEdit,
  onOpenProfile,
  onQuote,
  onJumpTo,
  onThreadReply,
  onOpenInTeams,
}: MessageProps): JSX.Element {
  useNameFormat();
  const { statusOf } = usePresence();
  const [pick, setPick] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Quote preserved while editing: the verbatim leading blockquote HTML, or ""
  // once the user removes it. null = message has no quote.
  const [editQuote, setEditQuote] = useState<string | null>(null);
  // Brief "copied" tick after copying the message text to the clipboard.
  const [copied, copy] = useCopied();
  // Close the reaction popover when clicking anywhere outside this message.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pick) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setPick(false);
    };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [pick]);
  const html = !m.deleted && isHtmlMsg(m);
  const text = m.deleted ? "" : messageText(m);
  const cards = !m.deleted && m.cards?.length ? m.cards : null;
  // A card message's text is only the card's summary: the card shows it already.
  const cardOnly = !!cards && /Media_Card/i.test(m.messageType);
  // Split any leading Skype Reply blockquote off the content so the textarea
  // holds just the reply body; the quote shows as a removable chip.
  const { quoteHtml: origQuote, body: bodyHtml } = splitQuote(m.content);
  const bodyText = htmlToText(bodyHtml);
  // The editor works in the composer's markdown-lite so formatting survives.
  // Only editing needs the Markdown form, so compute it on demand.
  const editSource = (): string => (html ? htmlToMarkdown(bodyHtml) : bodyText);
  const startEdit = (): void => {
    setDraft(editSource());
    setEditQuote(origQuote || null);
    setEditing(true);
  };
  const saveEdit = (): void => {
    const v = draft.trim();
    setEditing(false);
    const keptQuote = editQuote || "";
    // Save if the body changed, or the quote was removed.
    if ((v && v !== editSource()) || keptQuote !== (origQuote || "")) {
      if (v) onEdit(cid, m.id, v, keptQuote);
    }
  };
  const copyText = (): void => copy(bodyText || text);
  return (
    <div
      ref={root}
      data-mid={m.id}
      className={"tc-msg" + (first ? " first" : "") + (m.isReply && channel ? " reply" : "")}
    >
      {first ? (
        <Avatar
          name={m.from}
          uri={avatarUri(m.fromMri)}
          small={m.isReply && channel}
          mri={m.mine ? "" : m.fromMri}
          status={statusOf(m.fromMri)}
          onOpen={onOpenProfile}
        />
      ) : (
        // Continuation: the avatar column shows the time on hover instead.
        <span className={"tc-msg-gutter" + (m.isReply && channel ? " sm" : "")}>{fmtClock(m.time)}</span>
      )}
      <div className="tc-msg-body">
        {first && (
          <div className="tc-msg-meta">
            <span className="who">
              {personName(profile(m.fromMri), m.from, m.fromMri) || (m.mine ? t().common.you : t().common.unknown)}
            </span>
            {isAppMri(m.fromMri) ? <span className="tc-app-badge">{t().common.app}</span> : null}
            <span className="when" title={fmtFull(m.time)}>
              {fmtClock(m.time)}
            </span>
            {m.importance === "high" || m.importance === "urgent" ? (
              <span className="tc-imp">{t().chat.importance[m.importance]}</span>
            ) : null}
          </div>
        )}
        {m.subject && !m.isReply ? <div className="tc-subject">{htmlToText(m.subject)}</div> : null}
        {m.deleted ? (
          <div className="tc-deleted">
            {t().chat.deleted}
            {m.mine ? (
              <button className="tc-undo" onClick={() => onUndo(cid, m.id)}>
                <Undo2 size={13} /> {t().chat.undo}
              </button>
            ) : null}
          </div>
        ) : editing ? (
          <div className="tc-edit">
            {editQuote ? (
              <div className="tc-quote-chip">
                <Reply size={13} className="tc-quote-chip-icon" />
                <div className="tc-quote-chip-body">
                  <span className="tc-quote-chip-text">{oneLine(editQuote)}</span>
                </div>
                <button
                  className="tc-quote-chip-x"
                  onClick={() => setEditQuote("")}
                  title={t().chat.removeQuote}
                  aria-label={t().chat.removeQuote}
                >
                  <X size={13} />
                </button>
              </div>
            ) : null}
            <textarea
              className="tc-edit-area"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (handleFormatKey(e)) return;
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  saveEdit();
                }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="tc-edit-actions">
              <button className="tc-edit-save" onClick={saveEdit}>
                {t().common.save}
              </button>
              <button className="tc-edit-cancel" onClick={() => setEditing(false)}>
                {t().common.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div
            className={"tc-msg-content" + (html ? " rich" : "")}
            onClick={(e) => {
              // Click a quoted reply's blockquote to jump to the original.
              const bq = (e.target as Element).closest?.("blockquote.tc-reply");
              if (bq) {
                const id = bq.getAttribute("data-reply-id");
                if (id) onJumpTo?.(id);
              }
              // Click an inline image to view it large, with the message's other images.
              const img = (e.target as Element).closest?.("img.tc-inline-img");
              if (img) {
                const all = [...e.currentTarget.querySelectorAll<HTMLImageElement>("img.tc-inline-img")];
                openViewer(
                  all.map((el) => imageItem(el.currentSrc || el.src, el.alt)),
                  all.indexOf(img as HTMLImageElement),
                );
              }
            }}
          >
            {cardOnly ? null : html ? <RichHtml html={m.content} /> : <Linkified text={text} />}
            {m.edited ? <span className="tc-edited">{t().chat.edited}</span> : null}
          </div>
        )}
        {cards ? <Cards cards={cards} openInTeams={onOpenInTeams} /> : null}
        {m.files.length ? (
          <Attachments
            files={m.files}
            onRemove={m.mine && !m.deleted ? (i) => onRemoveFile(cid, m.id, i) : undefined}
          />
        ) : null}
        {!m.deleted && m.reactions.length ? (
          <div className="tc-reacts">
            {m.reactions.map((r) => (
              <button
                key={r.key}
                className={"tc-react" + (r.mine ? " mine" : "")}
                title={r.mine ? t().chat.removeReaction(r.key) : t().chat.react(r.key)}
                onClick={() => onReact(cid, m.id, r.key, !r.mine)}
              >
                {glyphFor(r.key)} {r.count}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!m.deleted && !editing ? (
        <div className="tc-tools">
          <div className="tc-tool-row">
            <button className="tc-tool" title={t().chat.addReaction} onClick={() => setPick((p) => !p)}>
              <SmilePlus size={16} />
            </button>
            <button className="tc-tool" title={copied ? t().chat.copied : t().chat.copyText} onClick={copyText}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            {channel && onThreadReply ? (
              <button className="tc-tool" title={t().chat.replyInThread} onClick={() => onThreadReply(m)}>
                <MessageSquareReply size={16} />
              </button>
            ) : null}
            <button className="tc-tool" title={t().chat.replyQuote} onClick={() => onQuote(m)}>
              <Reply size={16} />
            </button>
            {m.mine ? (
              <button className="tc-tool" title={t().chat.edit} onClick={startEdit}>
                <Pencil size={15} />
              </button>
            ) : null}
            {m.mine ? (
              <button className="tc-tool" title={t().chat.delete} onClick={() => onDelete(cid, m.id)}>
                <Trash2 size={15} />
              </button>
            ) : null}
          </div>
          {pick ? (
            <div className="tc-react-pop">
              {PICKER.map(([k, g]) => (
                <button
                  key={k}
                  className="tc-react-opt"
                  title={k}
                  onClick={() => {
                    setPick(false);
                    onReact(cid, m.id, k, true);
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
