import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { X } from "lucide-react";
import { ChatIcon } from "../shared/Avatar";
import { chatTitle, messageText, oneLine } from "../lib/format";
import { useModalExit } from "../lib/modalExit";
import { usePickerKeys } from "../lib/pickerKeys";
import { t } from "../../i18n";
import type { Chat, Message as Msg } from "../../types";

interface ForwardDialogProps {
  /** The message being forwarded (shown as a preview). */
  msg: Msg;
  /** Conversations to pick from; requests and chats you left are skipped. */
  chats: Chat[];
  /** Forward into `target` with an optional comment; resolves to an error text or null. */
  onForward: (target: Chat, comment: string) => Promise<string | null>;
  onClose: () => void;
}

const MAX_HITS = 12;

// Forward dialog: search your chats and channels, pick one, add an optional
// comment. The send goes through Teams' own forward path (forwardMessage in
// data/writes.ts), so the target shows the native forwarded-message card.
export function ForwardDialog({ msg, chats, onForward, onClose }: ForwardDialogProps): JSX.Element {
  const { closing, close } = useModalExit(onClose);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);

  useEffect(() => input.current?.focus(), []);

  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return chats
      .filter((c) => !c.left && !c.request)
      .filter((c) => {
        if (!words.length) return true;
        const hay = (chatTitle(c) + " " + (c.team || "")).toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, MAX_HITS);
  }, [chats, q]);

  const choose = (c: Chat): void => {
    setTarget(c);
    setQ("");
    setError(null);
    note.current?.focus();
  };

  const submit = async (): Promise<void> => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    const err = await onForward(target, text);
    setBusy(false);
    if (err) setError(err); // on success App closes the dialog
  };

  const { hi, setHi, onKey } = usePickerKeys(hits, choose, close);

  const s = t().chat;
  const preview = oneLine(messageText(msg)).slice(0, 160);

  return (
    <div
      className={"tc-scrim" + (closing ? " out" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="tc-newchat" role="dialog" aria-label={s.forwardTitle}>
        <div className="tc-newchat-head">
          <span>{s.forwardTitle}</span>
          <button className="tc-profile-close" onClick={close} title={t().common.close} aria-label={t().common.close}>
            <X size={16} />
          </button>
        </div>
        <div className="tc-fwd-preview">
          <b>{msg.from}</b>
          <span>{preview || "…"}</span>
        </div>
        <div className="tc-newchat-to" onClick={() => input.current?.focus()}>
          <span className="tc-newchat-label">{t().sidebar.to}</span>
          {target ? (
            <span className="tc-chip">
              <ChatIcon chat={target} small size={13} />
              <span className="tc-chip-name">{chatTitle(target)}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setTarget(null);
                  input.current?.focus();
                }}
                title={t().common.remove}
                aria-label={t().common.removeNamed(chatTitle(target))}
              >
                <X size={12} />
              </button>
            </span>
          ) : (
            <input
              ref={input}
              value={q}
              placeholder={s.forwardSearch}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
              }}
              onKeyDown={(e) => void onKey(e)}
            />
          )}
        </div>
        {!target && hits.length ? (
          <div className="tc-newchat-hits" role="listbox">
            {hits.map((c, i) => (
              <button
                key={c.id}
                role="option"
                aria-selected={i === hi}
                className={"tc-at-opt" + (i === hi ? " on" : "")}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(c);
                }}
              >
                <ChatIcon chat={c} small size={13} />
                <span className="tc-newchat-hit">
                  <span className="tc-at-name">{chatTitle(c)}</span>
                  {c.isChannel && c.team ? <small>{c.team}</small> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={note}
          className="tc-newchat-msg"
          rows={2}
          value={text}
          placeholder={s.forwardComment}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        {error ? <div className="tc-newchat-note">{error}</div> : null}
        <div className="tc-newchat-foot">
          <small> </small>
          <button className="tc-newchat-go" disabled={!target || busy} onClick={() => void submit()}>
            {busy ? s.forwarding : s.forward}
          </button>
        </div>
      </div>
    </div>
  );
}
