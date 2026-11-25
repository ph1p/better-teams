import { t } from "../../i18n";
import { useLayoutEffect, type JSX, type RefObject } from "react";
import { ChevronRight, ExternalLink, MessageSquareReply, RotateCw, Video } from "lucide-react";
import { Message } from "./Message";
import { Avatar } from "../shared/Avatar";
import { RichHtml } from "../../richText";
import { formatMessage } from "../../markdown";
import { avatarUri, continues, fmtClock, fmtDay, fmtTime, messageText } from "../lib/format";
import { LIVE_CALL_MS } from "../lib/constants";
import { fileKind, KindIcon } from "../lib/files";
import { extOf } from "../../data/raw";
import { useNow } from "../lib/now";
import type { Pending } from "../hooks/useMessages";
import type { Chat, Message as Msg } from "../../types";
import type { MentionPick } from "../../mentions";
import type { TeamsLink } from "../../teamsLinks";

interface TimelineProps {
  /** Messages to render (already filtered by the in-chat search). */
  visible: Msg[];
  cid: string;
  chat?: Chat;
  channel: boolean;
  selectedId?: string | null;
  pending: Pending[];
  /** Active in-chat search query (lower-cased), "" when off. */
  mq: string;
  searchText: string;
  /** Root id of the thread open in the thread pane, if any. */
  openThread?: string | null;
  onOpenThread: (rootId: string) => void;
  /** Filled after render: message id -> thread root id (channels). */
  msgRootRef: RefObject<Map<string, string>>;
  loading: boolean;
  ready: boolean;
  failed: boolean;
  empty: boolean;
  onRetry: () => void;
  onOpenInTeams: () => void;
  onReact: (cid: string, messageId: string, key: string, add: boolean) => void;
  onDelete: (cid: string, messageId: string) => void;
  onRemoveFile: (cid: string, messageId: string, index: number) => void;
  onUndo: (cid: string, messageId: string) => void;
  onEdit: (cid: string, messageId: string, text: string, quoteHtml: string, picks: readonly MentionPick[]) => void;
  onOpenProfile: (mri: string) => void;
  onQuote: (m: Msg) => void;
  onJumpTo: (mid: string) => void;
  onOpenMessage: (cid: string, mid: string) => void;
  onOpenTeamsLink: (link: TeamsLink) => boolean;
  onThreadReply: (m: Msg) => void;
  onForward: (m: Msg) => void;
  onJoinCall: (rootId: string) => void;
}


// Below a channel post: who replied, how many, and when last; opens the thread
// pane. Without replies it is a quiet "Reply" link.
function ThreadSummary({
  replies,
  pending,
  open,
  onOpen,
}: {
  replies: Msg[];
  pending: number;
  open: boolean;
  onOpen: () => void;
}) {
  const posts = replies.filter((m) => !m.call);
  const n = posts.length + pending;
  if (!n)
    return (
      <button className="tc-thread-reply" onClick={onOpen}>
        <MessageSquareReply size={14} /> {t().chat.reply}
      </button>
    );
  // Newest repliers first, one face each.
  const faces: Msg[] = [];
  for (let i = posts.length - 1; i >= 0 && faces.length < 3; i--)
    if (!faces.some((f) => f.fromMri === posts[i].fromMri)) faces.push(posts[i]);
  const last = posts.length ? posts[posts.length - 1].time : 0;
  return (
    <button
      className={"tc-thread-summary" + (open ? " open" : "")}
      onClick={onOpen}
      aria-expanded={open}
      title={t().chat.viewThread}
    >
      <span className="tc-thread-faces">
        {faces.map((f) => (
          <Avatar key={f.fromMri || f.id} name={f.from} uri={avatarUri(f.fromMri)} small />
        ))}
      </span>
      <span className="tc-thread-count">{t().chat.replies(n)}</span>
      {last ? <span className="tc-thread-last">{t().chat.lastReply(fmtTime(last))}</span> : null}
      <span className="tc-thread-view">{t().chat.viewThread}</span>
      <ChevronRight size={14} className="tc-thread-chev" />
    </button>
  );
}

/** A call that ended, as a one-line marker. */
export const CallEnd = ({ m }: { m: Msg }) => (
  <div className="tc-call-end">
    <Video size={13} /> {messageText(m)} · {fmtClock(m.time)}
  </div>
);

/** An own message still sending (text, then upload cards). */
export const renderPending = (p: Pending) => (
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

export function Timeline(p: TimelineProps) {
  const { visible, cid, chat, channel, pending: myPending, mq, msgRootRef } = p;
  const now = useNow(30_000);
  useLayoutEffect(() => {
    if (channel) msgRootRef.current = new Map(visible.map((m) => [m.id, m.rootId]));
  }, [channel, visible, msgRootRef]);
  const body: JSX.Element[] = [];
  const renderMsg = (m: Msg, first: boolean) => (
    <Message
      key={m.id}
      m={m}
      first={first}
      channel={channel}
      cid={cid}
      chat={chat}
      selected={m.id === p.selectedId}
      onReact={p.onReact}
      onDelete={p.onDelete}
      onRemoveFile={p.onRemoveFile}
      onUndo={p.onUndo}
      onEdit={p.onEdit}
      onOpenProfile={p.onOpenProfile}
      onQuote={p.onQuote}
      onJumpTo={p.onJumpTo}
      onOpenMessage={p.onOpenMessage}
      onOpenTeamsLink={p.onOpenTeamsLink}
      onThreadReply={channel ? p.onThreadReply : undefined}
      onForward={p.onForward}
      onOpenInTeams={p.onOpenInTeams}
    />
  );
  const renderReply = (m: Msg, first: boolean) =>
    m.call === "end" ? <CallEnd key={m.id} m={m} /> : renderMsg(m, first);
  // Pending thread replies render inside their thread; the rest at the bottom.
  const threadPending = new Set<number>();
  if (channel) {
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
      const mine = myPending.filter((x) => x.rootId === th.root);
      for (const x of mine) threadPending.add(x.key);
      // Live: Teams' own live state on the conversation (Chat.liveCall) names
      // the running call's root. Without the chat row, fall back to the posts:
      // a start without an end marker, younger than LIVE_CALL_MS.
      const live = chat
        ? chat.liveCall === th.root
        : rootMsg?.call === "start" && !th.msgs.some((m) => m.call === "end") && now - rootMsg.time < LIVE_CALL_MS;
      const open = p.openThread === th.root;
      body.push(
        <div key={"t" + th.root} className={"tc-thread" + (open ? " open" : "") + (live ? " live" : "")}>
          {live ? (
            <span className="tc-live-badge">
              <span className="tc-live-dot" /> {t().chat.live}
            </span>
          ) : null}
          {rootMsg ? renderMsg(rootMsg, true) : <div className="tc-thread-orphan">{t().chat.olderPost}</div>}
          {/* Searching: the matching replies show in place, so hits are visible. */}
          {mq && replies.length ? (
            <div className="tc-thread-replies">
              {replies.map((m, i) => renderReply(m, !continues(i ? replies[i - 1] : null, m)))}
            </div>
          ) : null}
          <div className="tc-thread-actions">
            <ThreadSummary
              replies={replies}
              pending={mine.length}
              open={open}
              onOpen={() => p.onOpenThread(th.root)}
            />
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
