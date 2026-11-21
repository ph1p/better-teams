import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { myMri, type PeopleHit } from "../../teamsData";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { usePeopleSearch } from "../lib/peopleSearch";
import { t } from "../../i18n";

/** Outcome of a start attempt, reported back by App. */
export type NewChatOutcome =
  | { kind: "done" }
  | { kind: "draft" } // Teams shows an empty new chat: needs a first message
  | { kind: "error"; message: string };

interface NewChatProps {
  /** Start (or open) the chat with `people`; `text` is the optional first message. */
  onStart: (people: PeopleHit[], text: string) => Promise<NewChatOutcome>;
  onClose: () => void;
  /** People to start with (e.g. from a profile's Message button). */
  initial?: PeopleHit[];
  /** Teams already shows the empty draft for `initial`. */
  initialDraft?: boolean;
  /** People from known chats; searched locally, instantly, before the directory. */
  known?: () => PeopleHit[];
}

// "New chat" dialog: pick one or more people from the org directory (the same
// substrate search as @mentions), optionally type a first message. App drives
// Teams' own New message flow with them (send.ts openNativeNewChat), so the
// result is exactly what the stock UI would create.
export function NewChat({ onStart, onClose, initial, initialDraft, known }: NewChatProps): JSX.Element {
  const [picked, setPicked] = useState<PeopleHit[]>(initial || []);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [isDraft, setIsDraft] = useState(!!initialDraft);
  // What to tell the user under the message box: Teams wants a first message
  // (draft), or why starting failed (error text from App).
  const [note, setNote] = useState<{ kind: "draft" } | { kind: "error"; message: string } | null>(
    initialDraft ? { kind: "draft" } : null,
  );
  const [people] = useState(() => known?.() || []);
  const hits = usePeopleSearch(q, people, 12);
  const input = useRef<HTMLInputElement>(null);
  const msg = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (initialDraft ? msg : input).current?.focus();
  }, [initialDraft]);

  const me = myMri();
  const shown = hits.filter((h) => h.mri !== me && !picked.some((p) => p.mri === h.mri));

  const changed = (): void => {
    setIsDraft(false);
    setNote(null);
  };
  const add = (p: PeopleHit): void => {
    setPicked((s) => [...s, p]);
    setQ("");
    changed();
    input.current?.focus();
  };
  const remove = (mri: string): void => {
    setPicked((s) => s.filter((p) => p.mri !== mri));
    changed();
  };

  const submit = async (): Promise<void> => {
    if (!picked.length || busy) return;
    setBusy(true);
    setNote(null);
    const r = await onStart(picked, text.trim());
    setBusy(false);
    if (r.kind === "done") return; // App closes the dialog
    if (r.kind === "draft") {
      setIsDraft(true);
      setNote({ kind: "draft" });
      msg.current?.focus();
      return;
    }
    setNote(r);
  };

  const onInputKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown" && shown.length) {
      e.preventDefault();
      setHi((i) => (i + 1) % shown.length);
    } else if (e.key === "ArrowUp" && shown.length) {
      e.preventDefault();
      setHi((i) => (i - 1 + shown.length) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[hi]) add(shown[hi]);
      else if (!q && picked.length) msg.current?.focus();
    } else if (e.key === "Backspace" && !q && picked.length) remove(picked[picked.length - 1].mri);
    else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const s = t().sidebar;
  const label = busy ? s.opening : text.trim() || isDraft ? t().common.send : s.openChat;

  return (
    <div
      className="tc-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tc-newchat" role="dialog" aria-label={s.newChat}>
        <div className="tc-newchat-head">
          <span>{s.newChat}</span>
          <button className="tc-profile-close" onClick={onClose} title={t().common.close} aria-label={t().common.close}>
            <X size={16} />
          </button>
        </div>
        <div className="tc-newchat-to" onClick={() => input.current?.focus()}>
          <span className="tc-newchat-label">{s.to}</span>
          {picked.map((p) => (
            <span key={p.mri} className="tc-chip">
              <Avatar name={p.displayName} uri={avatarUri(p.mri)} small />
              <span className="tc-chip-name">{p.displayName}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  remove(p.mri);
                }}
                title={t().common.remove}
                aria-label={t().common.removeNamed(p.displayName)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            ref={input}
            value={q}
            placeholder={picked.length ? s.addMorePeople : s.typeNameOrEmail}
            onChange={(e) => {
              setQ(e.target.value);
              setHi(0);
            }}
            onKeyDown={onInputKey}
          />
        </div>
        {shown.length ? (
          <div className="tc-newchat-hits" role="listbox">
            {shown.map((h, i) => (
              <button
                key={h.mri}
                role="option"
                aria-selected={i === hi}
                className={"tc-at-opt" + (i === hi ? " on" : "")}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(h);
                }}
              >
                <Avatar name={h.displayName} uri={avatarUri(h.mri)} small />
                <span className="tc-newchat-hit">
                  <span className="tc-at-name">{h.displayName}</span>
                  {h.jobTitle || h.email ? <small>{h.jobTitle || h.email}</small> : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={msg}
          className="tc-newchat-msg"
          rows={3}
          value={text}
          placeholder={isDraft ? s.firstMessage : s.firstMessageOptional}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        {note ? <div className="tc-newchat-note">{note.kind === "draft" ? s.draftNote : note.message}</div> : null}
        <div className="tc-newchat-foot">
          <small>{picked.length > 1 ? s.groupOf(picked.length) : " "}</small>
          <button
            className="tc-newchat-go"
            disabled={!picked.length || busy || (isDraft && !text.trim())}
            onClick={() => void submit()}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}
