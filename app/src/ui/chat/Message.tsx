import { memo, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { t } from "../../i18n";
import { personName, useNameFormat } from "../../names";
import { profile } from "../../teamsData";
import {
  SmilePlus,
  Pencil,
  CornerDownLeft,
  Trash2,
  Undo2,
  X,
  Reply,
  Copy,
  Check,
  MessageSquareReply,
  Forward,
} from "lucide-react";
import { splitForward, splitQuote } from "../../quote";
import { RichHtml } from "../../richText";
import { Avatar } from "../shared/Avatar";
import { Attachments } from "./Attachments";
import { Cards } from "./Cards";
import { isAppMri } from "../../apps";
import { Linkified } from "../shared/Linkified";
import {
  avatarUri,
  fmtClock,
  fmtFull,
  fmtGutterClock,
  fmtStamp,
  htmlToText,
  isHtmlMsg,
  messageText,
  oneLine,
} from "../lib/format";
import { useEditRequest } from "../lib/editRequest";
import { MessageEditor } from "./MessageEditor";
import { Reactions } from "./Reactions";
import { parseTeamsLink, type TeamsLink } from "../../teamsLinks";
import { editMentions, type MentionPick } from "../../mentions";
import { htmlToMarkdown } from "../lib/htmlToMarkdown";
import { usePresence } from "../lib/presence";
import { PICKER } from "../lib/reactions";
import { imageItem, openViewer } from "../lib/files";
import { useCopied } from "../lib/clipboard";
import type { Chat, Message as Msg } from "../../types";

interface ForwardCardProps {
  m: Msg;
  /** The original message's HTML (inside the Forward blockquote). */
  body: string;
  onOpenProfile: (mri: string) => void;
  onOpenMessage?: (cid: string, mid: string) => void;
}

// A forwarded message as Teams shows it: a bordered card with the original
// sender and send time on top; clicking it opens the original in its chat.
function ForwardCard({ m, body, onOpenProfile, onOpenMessage }: ForwardCardProps): JSX.Element {
  const f = m.forwarded;
  const s = t().chat;
  const name = f ? personName(profile(f.senderMri), f.sender, f.senderMri) : "";
  const open = f?.threadId && onOpenMessage ? (): void => onOpenMessage(f.threadId, f.messageId) : undefined;
  const canOpen = !!open;
  const When = canOpen ? "button" : "span";
  return (
    <div
      className={"tc-fwd" + (canOpen ? " open" : "")}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      title={canOpen ? s.openOriginal : undefined}
      onClick={(e) => {
        // Links, images, mentions and buttons inside keep their own click.
        if ((e.target as Element).closest?.("a, img, button, .tc-mention, .tc-av-btn")) return;
        e.stopPropagation();
        open?.();
      }}
      onKeyDown={(e) => {
        if (open && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="tc-fwd-head">
        <Forward size={14} className="tc-fwd-icon" aria-label={s.forwardedFrom} />
        {f && name ? (
          <>
            <Avatar
              name={name}
              uri={avatarUri(f.senderMri)}
              mri={f.senderMri}
              small
              className="xs"
              onOpen={onOpenProfile}
            />
            <button className="tc-fwd-who" onClick={() => onOpenProfile(f.senderMri)}>
              {name}
            </button>
          </>
        ) : (
          <span className="tc-fwd-who">{s.forwardedFrom}</span>
        )}
        {f?.time ? (
          <When className="tc-fwd-when" title={fmtFull(f.time)} onClick={open}>
            {fmtStamp(f.time)}
          </When>
        ) : null}
      </div>
      <div className="tc-fwd-body">
        <RichHtml html={body} />
      </div>
    </div>
  );
}

interface MessageProps {
  m: Msg;
  first: boolean;
  channel: boolean;
  cid: string;
  /** The open chat (members feed the editor's @mention picker). */
  chat?: Chat;
  /** Picked with the arrow keys (see useMessageNav). */
  selected?: boolean;
  onReact: (cid: string, messageId: string, key: string, add: boolean) => void;
  onDelete: (cid: string, messageId: string) => void;
  onRemoveFile: (cid: string, messageId: string, index: number) => void;
  onUndo: (cid: string, messageId: string) => void;
  onEdit: (cid: string, messageId: string, text: string, quoteHtml: string, picks: readonly MentionPick[]) => void;
  onOpenProfile: (mri: string) => void;
  onQuote: (m: Msg) => void;
  onJumpTo?: (mid: string) => void;
  /** Open a message in its conversation (a forward's original). */
  onOpenMessage?: (cid: string, mid: string) => void;
  /** A Teams deep link was clicked; true when it was opened here. */
  onOpenTeamsLink?: (link: TeamsLink) => boolean;
  /** Channels only: answer in this message's thread. */
  onThreadReply?: (m: Msg) => void;
  /** Forward this message to another chat or channel. */
  onForward?: (m: Msg) => void;
  /** Card buttons that post back to a bot hand off to Teams. */
  onOpenInTeams?: () => void;
}

// One rendered message: avatar + meta on the first of a group, content (rich
// HTML or linkified text), files, reactions, and a hover toolbar (react / quote
// / edit / delete). Edit swaps the content for the shared MessageEditor with a
// quote chip.
export const Message = memo(function Message({
  m,
  first,
  channel,
  cid,
  chat,
  selected,
  onReact,
  onDelete,
  onRemoveFile,
  onUndo,
  onEdit,
  onOpenProfile,
  onQuote,
  onJumpTo,
  onThreadReply,
  onForward,
  onOpenInTeams,
  onOpenMessage,
  onOpenTeamsLink,
}: MessageProps): JSX.Element {
  useNameFormat();
  const { statusOf } = usePresence();
  const [pick, setPick] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // @mentions in the edit draft: the message's own (rebuilt from its mention
  // spans) plus any picked while editing.
  const [editPicks, setEditPicks] = useState<readonly MentionPick[]>([]);
  // Where focus returns when the edit ends (the composer, for Arrow Up edits).
  const editBack = useRef<(() => void) | undefined>(undefined);
  const editInput = useRef<HTMLTextAreaElement>(null);
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
  const fwd = useMemo(() => (html ? splitForward(m.content) : null), [html, m.content]);
  // A card message's text is only the card's summary: the card shows it already.
  const cardOnly = !!cards && /Media_Card/i.test(m.messageType);
  // Split any leading Skype Reply blockquote off the content so the textarea
  // holds just the reply body; the quote shows as a removable chip.
  const { origQuote, bodyHtml, bodyText } = useMemo(() => {
    const q = splitQuote(m.content);
    return { origQuote: q.quoteHtml, bodyHtml: q.body, bodyText: htmlToText(q.body) };
  }, [m.content]);
  // The editor works in the composer's markdown-lite so formatting survives.
  // Only editing needs the Markdown form, so compute it on demand. Mention
  // spans come back as "@Name" with their picks, so mentions survive the edit.
  const editSource = (): { text: string; picks: MentionPick[] } => {
    if (!html) return { text: bodyText, picks: [] };
    const em = editMentions(m.mentions ?? []);
    const text = htmlToMarkdown(bodyHtml, em.mark);
    return { text, picks: em.picks() };
  };
  const startEdit = (back?: () => void): void => {
    const src = editSource();
    setDraft(src.text);
    setEditPicks(src.picks);
    setEditQuote(origQuote || null);
    editBack.current = back;
    setEditing(true);
    setPick(false);
  };
  const endEdit = (): void => {
    setEditing(false);
    editBack.current?.();
    editBack.current = undefined;
  };
  const saveEdit = (): void => {
    const v = draft.trim();
    endEdit();
    const keptQuote = editQuote || "";
    // Save if the body changed, or the quote was removed.
    if ((v && v !== editSource().text.trim()) || keptQuote !== (origQuote || "")) {
      if (v) onEdit(cid, m.id, v, keptQuote, editPicks);
    }
  };
  const editable = m.mine && !m.deleted && !cards;
  useEditRequest(m.id, editable, startEdit);
  // An edit opened from the composer (Arrow Up) may be off screen.
  useEffect(() => {
    if (editing) editInput.current?.closest(".tc-msg")?.scrollIntoView({ block: "nearest" });
  }, [editing]);
  const copyText = (): void => copy(bodyText || text);
  return (
    <div
      ref={root}
      data-mid={m.id}
      className={
        "tc-msg" + (first ? " first" : "") + (m.isReply && channel ? " reply" : "") + (selected ? " kbd-sel" : "")
      }
      data-hint={selected ? t().chat.selectHint(editable) : undefined}
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
        <span className={"tc-msg-gutter" + (m.isReply && channel ? " sm" : "")} title={fmtFull(m.time)}>
          {fmtGutterClock(m.time)}
        </span>
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
            <MessageEditor
              chat={chat ?? { id: cid, isChannel: channel, members: [] }}
              value={draft}
              onChange={setDraft}
              inputRef={editInput}
              picks={editPicks}
              onPick={(p) => setEditPicks((cur) => (cur.some((x) => x.mri === p.mri) ? cur : [...cur, p]))}
              onSubmit={saveEdit}
              onEscape={() => {
                endEdit();
                return true;
              }}
              autoFocus
            />
            <div className="tc-edit-actions">
              <span className="tc-edit-hint">{t().chat.editHint}</span>
              <button className="tc-edit-btn" onClick={endEdit}>
                {t().common.cancel}
                <kbd>Esc</kbd>
              </button>
              <button className="tc-edit-btn primary" onClick={saveEdit} disabled={!draft.trim()}>
                <Check size={13} />
                {t().common.save}
                <kbd>
                  <CornerDownLeft size={11} />
                </kbd>
              </button>
            </div>
          </div>
        ) : (
          <div
            className={"tc-msg-content" + (html ? " rich" : "")}
            onClick={(e) => {
              // A Teams link to a chat or message we have opens here, not in
              // a new Teams tab. Modified clicks keep the browser's behaviour.
              const a = (e.target as Element).closest?.("a[href]");
              if (a && onOpenTeamsLink && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
                const link = parseTeamsLink((a as HTMLAnchorElement).href);
                if (link && onOpenTeamsLink(link)) {
                  e.preventDefault();
                  return;
                }
              }
              // Click a quoted reply's blockquote to jump to the original.
              const bq = (e.target as Element).closest?.("blockquote.tc-reply");
              if (bq) {
                const id = bq.getAttribute("data-reply-id");
                if (id) onJumpTo?.(id);
              }
              // Click a person @mention to open their profile (tag/channel/team
              // mentions have no person behind them).
              const at = (e.target as Element).closest?.(".tc-mention[data-mention-id]");
              if (at) {
                const id = Number(at.getAttribute("data-mention-id"));
                const ref = m.mentions?.find((x) => x.itemid === id);
                if (ref && ref.mentionType === "person" && ref.mri) onOpenProfile(ref.mri);
              }
              // Click an inline image to view it large, with the message's other images.
              const img = (e.target as Element).closest?.("img.tc-inline-img");
              if (img) {
                const all = [...e.currentTarget.querySelectorAll<HTMLImageElement>("img.tc-inline-img")];
                openViewer(
                  all.map((el) => imageItem(el.currentSrc || el.src, el.alt, el.dataset.link)),
                  all.indexOf(img as HTMLImageElement),
                );
              }
            }}
          >
            {cardOnly ? null : fwd ? (
              <>
                {fwd.comment ? <RichHtml html={fwd.comment} /> : null}
                <ForwardCard m={m} body={fwd.body} onOpenProfile={onOpenProfile} onOpenMessage={onOpenMessage} />
              </>
            ) : html ? (
              <RichHtml html={m.content} />
            ) : (
              <Linkified text={text} />
            )}
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
          <Reactions
            reactions={m.reactions}
            onReact={(key, add) => onReact(cid, m.id, key, add)}
            onOpenProfile={onOpenProfile}
          />
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
            {onForward ? (
              <button className="tc-tool" title={t().chat.forward} onClick={() => onForward(m)}>
                <Forward size={16} />
              </button>
            ) : null}
            {m.mine ? (
              <button className="tc-tool" title={t().chat.edit} onClick={() => startEdit()}>
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
