import { useEffect, useRef, useState, type JSX } from "react";
import {
  SmilePlus, Pencil, Trash2, Undo2, Paperclip, X, Reply, Copy, Check, MessageSquareReply,
} from "lucide-react";
import { splitQuote } from "../../quote";
import { RichHtml } from "../../richText";
import { Avatar } from "../shared/Avatar";
import { isAppMri } from "../../apps";
import { Linkified } from "../shared/Linkified";
import { avatarUri, fmtClock, htmlToText, isHtmlMsg, messageText, oneLine } from "../lib/format";
import { handleFormatKey } from "../lib/editKeys";
import { htmlToMarkdown } from "../lib/htmlToMarkdown";
import { usePresence } from "../lib/presence";
import { glyphFor, PICKER } from "../lib/reactions";
import type { Message as Msg } from "../../types";

interface MessageProps {
  m: Msg;
  first: boolean;
  channel: boolean;
  cid: string;
  onReact: (cid: string, messageId: string, key: string, add: boolean) => void;
  onDelete: (cid: string, messageId: string) => void;
  onUndo: (cid: string, messageId: string) => void;
  onEdit: (cid: string, messageId: string, text: string, quoteHtml: string) => void;
  onOpenProfile: (mri: string) => void;
  onQuote: (m: Msg) => void;
  onJumpTo?: (mid: string) => void;
  /** Channels only: answer in this message's thread. */
  onThreadReply?: (m: Msg) => void;
}

// One rendered message: avatar + meta on the first of a group, content (rich
// HTML or linkified text), files, reactions, and a hover toolbar (react / quote
// / edit / delete). Edit swaps the content for a textarea with a quote chip.
export function Message({ m, first, channel, cid, onReact, onDelete, onUndo, onEdit, onOpenProfile, onQuote, onJumpTo, onThreadReply }: MessageProps): JSX.Element {
  const { statusOf } = usePresence();
  const [pick, setPick] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Quote preserved while editing: the verbatim leading blockquote HTML, or ""
  // once the user removes it. null = message has no quote.
  const [editQuote, setEditQuote] = useState<string | null>(null);
  // Brief "copied" tick after copying the message text to the clipboard.
  const [copied, setCopied] = useState(false);
  // Close the reaction popover when clicking anywhere outside this message.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pick) return;
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setPick(false); };
    document.addEventListener("mousedown", onDoc, true);
    return () => document.removeEventListener("mousedown", onDoc, true);
  }, [pick]);
  const html = !m.deleted && isHtmlMsg(m);
  const text = m.deleted ? "" : messageText(m);
  // Split any leading Skype Reply blockquote off the content so the textarea
  // holds just the reply body; the quote shows as a removable chip.
  const { quoteHtml: origQuote, body: bodyHtml } = splitQuote(m.content);
  const bodyText = htmlToText(bodyHtml);
  // The editor works in the composer's markdown-lite so formatting survives.
  const bodyMd = html ? htmlToMarkdown(bodyHtml) : bodyText;
  const startEdit = (): void => {
    setDraft(bodyMd);
    setEditQuote(origQuote || null);
    setEditing(true);
  };
  const saveEdit = (): void => {
    const v = draft.trim();
    setEditing(false);
    const keptQuote = editQuote || "";
    // Save if the body changed, or the quote was removed.
    if ((v && v !== bodyMd) || keptQuote !== (origQuote || "")) {
      if (v) onEdit(cid, m.id, v, keptQuote);
    }
  };
  const copyText = (): void => {
    const t = bodyText || text;
    if (!t) return;
    Promise.resolve(navigator.clipboard?.writeText(t))
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })
      .catch(() => { /* clipboard blocked; ignore */ });
  };
  return (
    <div ref={root} data-mid={m.id} className={"tc-msg" + (first ? " first" : "") + (m.isReply && channel ? " reply" : "")}>
      {first ? (
        <Avatar name={m.from} uri={avatarUri(m.fromMri)} small={m.isReply && channel} mri={m.mine ? "" : m.fromMri} status={statusOf(m.fromMri)} onOpen={onOpenProfile} />
      ) : (
        // Continuation: the avatar column shows the time on hover instead.
        <span className={"tc-msg-gutter" + (m.isReply && channel ? " sm" : "")}>{fmtClock(m.time)}</span>
      )}
      <div className="tc-msg-body">
        {first && (
          <div className="tc-msg-meta">
            <span className="who">{m.from || (m.mine ? "You" : "Unknown")}</span>
            {isAppMri(m.fromMri) ? <span className="tc-app-badge">App</span> : null}
            <span className="when" title={new Date(m.time).toLocaleString()}>{fmtClock(m.time)}</span>
            {m.importance === "high" || m.importance === "urgent" ? (
              <span className="tc-imp">{m.importance}</span>
            ) : null}
          </div>
        )}
        {m.subject && !m.isReply ? <div className="tc-subject">{htmlToText(m.subject)}</div> : null}
        {m.deleted ? (
          <div className="tc-deleted">
            Message deleted
            {m.mine ? <button className="tc-undo" onClick={() => onUndo(cid, m.id)}><Undo2 size={13} /> Undo</button> : null}
          </div>
        ) : editing ? (
          <div className="tc-edit">
            {editQuote ? (
              <div className="tc-quote-chip">
                <Reply size={13} className="tc-quote-chip-icon" />
                <div className="tc-quote-chip-body">
                  <span className="tc-quote-chip-text">{oneLine(editQuote)}</span>
                </div>
                <button className="tc-quote-chip-x" onClick={() => setEditQuote("")} title="Remove quote" aria-label="Remove quote"><X size={13} /></button>
              </div>
            ) : null}
            <textarea
              className="tc-edit-area"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (handleFormatKey(e)) return;
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); saveEdit(); }
                if (e.key === "Escape") setEditing(false);
              }}
            />
            <div className="tc-edit-actions">
              <button className="tc-edit-save" onClick={saveEdit}>Save</button>
              <button className="tc-edit-cancel" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div
            className={"tc-msg-content" + (html ? " rich" : "")}
            onClick={(e) => {
              // Click a quoted reply's blockquote to jump to the original.
              const bq = (e.target as Element).closest?.("blockquote.tc-reply");
              if (bq) { const id = bq.getAttribute("data-reply-id"); if (id) onJumpTo?.(id); }
            }}
          >
            {html ? <RichHtml html={m.content} /> : <Linkified text={text} />}
            {m.edited ? <span className="tc-edited"> (edited)</span> : null}
          </div>
        )}
        {m.files.length ? (
          <div className="tc-files">
            {m.files.map((f, i) =>
              f.url ? (
                <a key={i} className="tc-file" href={f.url} target="_blank" rel="noreferrer noopener"><Paperclip size={13} /> {f.name}</a>
              ) : (
                <span key={i} className="tc-file"><Paperclip size={13} /> {f.name}</span>
              )
            )}
          </div>
        ) : null}
        {!m.deleted && m.reactions.length ? (
          <div className="tc-reacts">
            {m.reactions.map((r) => (
              <button
                key={r.key}
                className={"tc-react" + (r.mine ? " mine" : "")}
                title={r.mine ? "Remove your " + r.key : "React " + r.key}
                onClick={() => onReact(cid, m.id, r.key, !r.mine)}
              >
                {glyphFor(r)} {r.count}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {!m.deleted && !editing ? (
        <div className="tc-tools">
          <div className="tc-tool-row">
            <button className="tc-tool" title="Add reaction" onClick={() => setPick((p) => !p)}><SmilePlus size={16} /></button>
            <button className="tc-tool" title={copied ? "Copied" : "Copy text"} onClick={copyText}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
            {channel && onThreadReply ? (
              <button className="tc-tool" title="Reply in thread" onClick={() => onThreadReply(m)}><MessageSquareReply size={16} /></button>
            ) : null}
            <button className="tc-tool" title="Reply with quote" onClick={() => onQuote(m)}><Reply size={16} /></button>
            {m.mine ? <button className="tc-tool" title="Edit" onClick={startEdit}><Pencil size={15} /></button> : null}
            {m.mine ? <button className="tc-tool" title="Delete" onClick={() => onDelete(cid, m.id)}><Trash2 size={15} /></button> : null}
          </div>
          {pick ? (
            <div className="tc-react-pop">
              {PICKER.map(([k, g]) => (
                <button key={k} className="tc-react-opt" title={k}
                  onClick={() => { setPick(false); onReact(cid, m.id, k, true); }}>{g}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
