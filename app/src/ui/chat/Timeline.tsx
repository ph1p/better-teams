import { t } from "../../i18n";
import type { JSX, RefObject } from "react";
import { ChevronsUpDown, ExternalLink, MessageSquareReply, RotateCw, Video } from "lucide-react";
import { Message } from "./Message";
import { Avatar } from "../shared/Avatar";
import { RichHtml } from "../../richText";
import { formatMessage } from "../../markdown";
import { fmtClock, fmtDay, messageText } from "../lib/format";
import { GROUP_GAP_MS, LIVE_CALL_MS, THREAD_TAIL } from "../lib/constants";
import { fileKind, KindIcon } from "../lib/files";
import { extOf } from "../../data/raw";
import type { Pending } from "../hooks/useMessages";
import type { Chat, Message as Msg } from "../../types";

interface TimelineProps {
  /** Messages to render (already filtered by the in-chat search). */
  visible: Msg[];
  cid: string;
  chat?: Chat;
  channel: boolean;
  /** My optimistic messages for this chat. */
  pending: Pending[];
  /** Active in-chat search query (lower-cased), "" when off. */
  mq: string;
  /** The query as typed, for the "no match" note. */
  searchText: string;
  openThreads: ReadonlySet<string>;
  onToggleThread: (rootId: string) => void;
  /** Root id of the thread the composer answers in, if any. */
  replyingTo?: string;
  /** Filled during render: message id -> thread root id (channels). */
  msgRoot: RefObject<Map<string, string>>;
  // Empty / loading state.
  loading: boolean;
  /** The open chat's messages arrived (possibly empty). */
  ready: boolean;
  failed: boolean;
  empty: boolean;
  onRetry: () => void;
  onOpenInTeams: () => void;
  // Per-message actions.
  onReact: (cid: string, messageId: string, key: string, add: boolean) => void;
  onDelete: (cid: string, messageId: string) => void;
  onRemoveFile: (cid: string, messageId: string, index: number) => void;
  onUndo: (cid: string, messageId: string) => void;
  onEdit: (cid: string, messageId: string, text: string, quoteHtml?: string) => void;
  onOpenProfile: (mri: string) => void;
  onQuote: (m: Msg) => void;
  onJumpTo: (mid: string) => void;
  onThreadReply: (m: Msg) => void;
  onJoinCall: (rootId: string) => void;
}

// Same sender within a few minutes continues the previous message's group.
const continues = (prev: Msg | null, m: Msg): boolean =>
  !!prev && prev.fromMri === m.fromMri && m.time - prev.time <= GROUP_GAP_MS;

const renderPending = (p: Pending): JSX.Element => (
  <div key={p.key} className="tc-msg first pending">
    <Avatar name={t().common.you} />
    <div className="tc-msg-body">
      <div className="tc-msg-meta">
        <span className="who">{t().common.you}</span>
        <span className="when">{t().chat.sending}</span>
      </div>
      {p.text ? (
        <div className="tc-msg-content rich">
          <RichHtml html={formatMessage(p.text, [], () => "pending-" + p.key).html} />
        </div>
      ) : null}
      {p.files?.length ? (
        <div className="tc-attach">
          <div className="tc-cards">
            {p.files.map((name, i) => (
              <div key={i} className="tc-card uploading">
                <span className="tc-card-main">
                  <KindIcon kind={fileKind(extOf(name))} className="tc-card-icon" size={18} />
                  <span className="tc-card-text">
                    <span className="tc-card-name">{name}</span>
                    <span className="tc-card-ext">{t().chat.uploading}</span>
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  </div>
);

// The open conversation's messages: day dividers and sender groups; channels
// as one card per thread. Ends with loose pending sends and the empty states.
export function Timeline(p: TimelineProps): JSX.Element {
  const { visible, cid, chat, channel, pending: myPending, mq, openThreads } = p;
  const body: JSX.Element[] = [];
  const renderMsg = (m: Msg, first: boolean): JSX.Element => (
    <Message
      key={m.id}
      m={m}
      first={first}
      channel={channel}
      cid={cid}
      onReact={p.onReact}
      onDelete={p.onDelete}
      onRemoveFile={p.onRemoveFile}
      onUndo={p.onUndo}
      onEdit={p.onEdit}
      onOpenProfile={p.onOpenProfile}
      onQuote={p.onQuote}
      onJumpTo={p.onJumpTo}
      onThreadReply={channel ? p.onThreadReply : undefined}
    />
  );
  // A meeting's end marker renders as one quiet line, not a message.
  const renderReply = (m: Msg, first: boolean): JSX.Element =>
    m.call === "end" ? (
      <div key={m.id} className="tc-call-end">
        <Video size={13} /> {messageText(m)} · {fmtClock(m.time)}
      </div>
    ) : (
      renderMsg(m, first)
    );
  // Pending thread replies render inside their thread; the rest at the bottom.
  const threadPending = new Set<number>();
  if (channel) {
    // Channels: one card per thread (root post + its replies, already sorted
    // by root time). Long threads show only the newest replies until expanded.
    // Group by rootId, not adjacency: a root's rootTime (its arrival time) and
    // its replies' rootTime (derived from the root id) can differ by a few ms,
    // which would sort them apart and orphan the replies.
    const byRoot = new Map<string, Msg[]>();
    for (const m of visible) {
      const g = byRoot.get(m.rootId);
      if (g) g.push(m);
      else byRoot.set(m.rootId, [m]);
    }
    const threads = [...byRoot].map(([root, ms]) => {
      ms.sort((a, b) => Number(a.isReply) - Number(b.isReply) || a.time - b.time);
      const head = ms[0];
      return { root, msgs: ms, at: head.isReply ? Math.min(...ms.map((m) => m.rootTime || m.time)) : head.time };
    });
    threads.sort((a, b) => a.at - b.at);
    p.msgRoot.current = new Map(visible.map((m) => [m.id, m.rootId]));
    let lastDay = "";
    for (const th of threads) {
      const head = th.msgs[0];
      const at = th.at;
      const day = new Date(at).toDateString();
      if (day !== lastDay) {
        body.push(
          <div key={"d" + th.root} className="tc-day">
            <span>{fmtDay(at)}</span>
          </div>,
        );
        lastDay = day;
      }
      const rootMsg = head.isReply ? null : head;
      const replies = rootMsg ? th.msgs.slice(1) : th.msgs;
      const expanded = !!mq || openThreads.has(th.root);
      const hidden = expanded ? 0 : Math.max(0, replies.length - THREAD_TAIL);
      const tail = replies.slice(hidden);
      const people = new Set(replies.filter((m) => !m.call).map((m) => m.fromMri)).size;
      const mine = myPending.filter((x) => x.rootId === th.root);
      for (const x of mine) threadPending.add(x.key);
      // Live: Teams' own live state on the conversation (Chat.liveCall) names
      // the running call's root. Without the chat row, fall back to the posts:
      // a start without an end marker, younger than LIVE_CALL_MS.
      const live = chat
        ? chat.liveCall === th.root
        : rootMsg?.call === "start" &&
          !th.msgs.some((m) => m.call === "end") &&
          Date.now() - rootMsg.time < LIVE_CALL_MS;
      body.push(
        <div
          key={"t" + th.root}
          className={"tc-thread" + (p.replyingTo === th.root ? " replying" : "") + (live ? " live" : "")}
        >
          {live ? (
            <span className="tc-live-badge">
              <span className="tc-live-dot" /> {t().chat.live}
            </span>
          ) : null}
          {rootMsg ? renderMsg(rootMsg, true) : <div className="tc-thread-orphan">{t().chat.olderPost}</div>}
          {replies.length || mine.length ? (
            <div className="tc-thread-replies">
              {hidden ? (
                <button className="tc-thread-more" onClick={() => p.onToggleThread(th.root)}>
                  <ChevronsUpDown size={13} /> {t().chat.earlierReplies(hidden)}
                  {people > 1 ? <span className="tc-thread-people">{t().chat.threadPeople(people)}</span> : null}
                </button>
              ) : null}
              {tail.map((m, i) => renderReply(m, !continues(i ? tail[i - 1] : null, m)))}
              {mine.map(renderPending)}
              {!mq && openThreads.has(th.root) && replies.length > THREAD_TAIL ? (
                <button className="tc-thread-more" onClick={() => p.onToggleThread(th.root)}>
                  <ChevronsUpDown size={13} /> {t().chat.collapse}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="tc-thread-actions">
            <button className="tc-thread-reply" onClick={() => p.onThreadReply(rootMsg || head)}>
              <MessageSquareReply size={14} /> {t().chat.reply}
            </button>
            {live ? (
              <button className="tc-join" onClick={() => p.onJoinCall(th.root)}>
                <Video size={14} /> {t().chat.joinCall}
              </button>
            ) : null}
          </div>
        </div>,
      );
    }
  } else {
    let prev: Msg | null = null;
    for (const m of visible) {
      if (!prev || new Date(prev.time).toDateString() !== new Date(m.time).toDateString()) {
        body.push(
          <div key={"d" + m.id} className="tc-day">
            <span>{fmtDay(m.time)}</span>
          </div>,
        );
        prev = null;
      }
      body.push(renderMsg(m, !continues(prev, m)));
      prev = m;
    }
  }

  return (
    <>
      {mq && !body.length ? (
        <div className="tc-empty">
          <p className="tc-sub">{t().chat.noMatch(p.searchText)}</p>
        </div>
      ) : null}
      {body}
      {myPending.filter((x) => !threadPending.has(x.key)).map(renderPending)}
      {p.loading && !myPending.length ? (
        <div className="tc-empty">
          <p className="tc-sub">{t().chat.loading}</p>
        </div>
      ) : null}
      {p.failed && p.empty && !myPending.length ? (
        <div className="tc-empty">
          <p>{t().chat.loadFailed}</p>
          <p className="tc-sub">{t().chat.loadFailedSub}</p>
          <div className="tc-empty-actions">
            <button className="tc-ghost" onClick={p.onRetry}>
              <RotateCw size={14} /> {t().chat.retry}
            </button>
            <button className="tc-ghost" onClick={p.onOpenInTeams}>
              <ExternalLink size={14} /> {t().chat.openInTeams}
            </button>
          </div>
        </div>
      ) : p.ready && p.empty && !myPending.length ? (
        <div className="tc-empty">
          <p>{t().chat.empty}</p>
          <button className="tc-ghost" onClick={p.onOpenInTeams}>
            {t().chat.openInTeams}
          </button>
        </div>
      ) : null}
    </>
  );
}
