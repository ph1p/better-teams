// Slack-style thread pane: a channel post with all its replies and a composer
// that answers in that thread. Docks to the right of the chat on wide windows.

import { useEffect, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { Message } from "./Message";
import { Composer } from "./Composer";
import { CallEnd, renderPending } from "./Timeline";
import { PaneResize, sideWidth } from "../shared/PaneResize";
import { chatTitle, continues } from "../lib/format";
import type { Pending } from "../hooks/useMessages";
import type { ComposerState } from "../hooks/useComposerState";
import type { Chat, Message as Msg } from "../../types";
import type { MentionPick } from "../../mentions";
import type { TeamsLink } from "../../teamsLinks";
import { t } from "../../i18n";

interface ThreadPanelProps {
  chat: Chat;
  rootId: string;
  /** The open channel's loaded messages (the thread is picked out here). */
  messages: Msg[];
  pending: Pending[];
  cs: ComposerState;
  onClose: () => void;
  onReact: (cid: string, messageId: string, key: string, add: boolean) => void;
  onDelete: (cid: string, messageId: string) => void;
  onRemoveFile: (cid: string, messageId: string, index: number) => void;
  onUndo: (cid: string, messageId: string) => void;
  onEdit: (cid: string, messageId: string, text: string, quoteHtml: string, picks: readonly MentionPick[]) => void;
  onOpenProfile: (mri: string) => void;
  onJumpTo: (mid: string) => void;
  onOpenMessage: (cid: string, mid: string) => void;
  onOpenTeamsLink: (link: TeamsLink) => boolean;
  onForward: (m: Msg) => void;
  onOpenInTeams: () => void;
}

// Near the bottom: new replies keep the pane pinned there.
const NEAR = 80;

export function ThreadPanel(p: ThreadPanelProps) {
  const { chat, rootId, cs } = p;
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const thread = p.messages.filter((m) => m.rootId === rootId);
  const root = thread.find((m) => !m.isReply);
  const replies = thread.filter((m) => m.isReply).sort((a, b) => a.time - b.time);
  const mine = p.pending.filter((x) => x.rootId === rootId);
  const count = replies.filter((m) => !m.call).length + mine.length;

  // A newly opened thread starts at its newest reply, with the composer ready.
  useLayoutEffect(() => {
    pinned.current = true;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rootId]);
  useEffect(() => {
    cs.composer.current?.focus();
  }, [rootId, cs.composer]);
  // Follow new replies (and own sends) while at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [replies.length, mine.length]);

  const renderMsg = (m: Msg, first: boolean) =>
    m.call === "end" ? (
      <CallEnd key={m.id} m={m} />
    ) : (
      <Message
        key={m.id}
        m={m}
        first={first}
        // Full-size rows and no "reply in thread" action: this is the thread.
        channel={false}
        cid={chat.id}
        chat={chat}
        onReact={p.onReact}
        onDelete={p.onDelete}
        onRemoveFile={p.onRemoveFile}
        onUndo={p.onUndo}
        onEdit={p.onEdit}
        onOpenProfile={p.onOpenProfile}
        onQuote={cs.onQuote}
        onJumpTo={p.onJumpTo}
        onOpenMessage={p.onOpenMessage}
        onOpenTeamsLink={p.onOpenTeamsLink}
        onForward={p.onForward}
        onOpenInTeams={p.onOpenInTeams}
      />
    );

  return (
    <aside
      className="tc-profile tc-pane tc-thread-panel"
      aria-label={t().chat.thread}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          p.onClose();
        }
      }}
    >
      <PaneResize
        // A share of the room beside the sidebar: the thread grows with the
        // window instead of needing a resize every time it opens.
        pref="threadShare"
        cssVar="--tc-pane-w"
        share
        def={0.45}
        min={340}
        max={0.7}
        edge="left"
        label={t().chat.resizeThread}
        taken={sideWidth}
      />
      <div className="tc-notes-head">
        <span className="tc-thread-panel-title">
          <span className="tc-notes-title">{t().chat.thread}</span>
          <span className="tc-thread-panel-where">#{chatTitle(chat)}</span>
        </span>
        <button
          className="tc-profile-close"
          onClick={p.onClose}
          title={t().chat.closeThreadTitle}
          aria-label={t().chat.closeThread}
        >
          <X size={16} />
        </button>
      </div>
      <div
        className="tc-thread-panel-msgs"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
        }}
      >
        {root ? renderMsg(root, true) : <div className="tc-thread-orphan">{t().chat.olderPost}</div>}
        <div className="tc-thread-panel-sep">
          <span>{count ? t().chat.replies(count) : t().chat.noReplies}</span>
        </div>
        {replies.map((m, i) => renderMsg(m, !continues(i ? replies[i - 1] : null, m)))}
        {mine.map(renderPending)}
      </div>
      {chat.request ? null : <Composer chat={chat} cs={cs} />}
    </aside>
  );
}
