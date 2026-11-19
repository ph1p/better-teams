import { useEffect, useRef, useState, type JSX, type CSSProperties } from "react";
import { ArrowLeftRight, Check, RotateCcw, ChevronUp, MessageSquare } from "lucide-react";
import { myMri, profile } from "../../teamsData";
import { myNote, setMyNote, setMyStatus, type NoteExpiry, type SettableStatus } from "../../status";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { STATUS_COLOR, STATUS_LABEL, setSelfPresence, usePresence, type Status } from "../lib/presence";


const CHOICES: Array<[Exclude<SettableStatus, "Reset">, string]> = [
  ["Available", "Available"],
  ["Busy", "Busy"],
  ["DoNotDisturb", "Do not disturb"],
  ["BeRightBack", "Be right back"],
  ["Away", "Appear away"],
  ["Offline", "Appear offline"],
];

const EXPIRY: Array<[NoteExpiry, string]> = [
  ["never", "Never"],
  ["1h", "1 hour"],
  ["4h", "4 hours"],
  ["today", "Today"],
  ["week", "This week"],
];

interface MeBarProps {
  onSwitchToTeams?: () => void;
  onError?: (msg: string) => void;
}

// Sidebar footer: the signed-in user with their presence, plus a menu to change
// status (REST when possible, else Teams' own profile menu), to set a status
// message, and to switch to the native Teams UI underneath.
export function MeBar({ onSwitchToTeams, onError }: MeBarProps): JSX.Element {
  const { statusOf, self } = usePresence();
  const [open, setOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [expiry, setExpiry] = useState<NoteExpiry>("today");
  const [pinned, setPinned] = useState(false);
  const [, rerender] = useState(0);
  const note = myNote();
  const box = useRef<HTMLDivElement>(null);
  const mri = myMri();
  const p = mri ? profile(mri) : null;
  const name = (p && p.displayName) || "You";
  const s = self();
  const status: Status = s !== "Unknown" ? s : statusOf(mri);

  useEffect(() => {
    if (!open) { setNoteOpen(false); return; }
    const close = (e: Event): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const choose = async (st: SettableStatus): Promise<void> => {
    setOpen(false);
    const prev = status;
    if (st !== "Reset") setSelfPresence(st);
    const r = await setMyStatus(st);
    if (!r.ok) {
      setSelfPresence(prev);
      onError?.("Couldn't change status: " + r.reason);
    }
  };

  const saveNote = async (text: string): Promise<void> => {
    const r = await setMyNote(text, expiry, pinned);
    if (!r.ok) { onError?.("Couldn't set status message: " + r.reason); return; }
    setOpen(false);
    rerender((n) => n + 1);
  };

  return (
    <div className="tc-me" ref={box}>
      {open ? (
        <div className="tc-me-menu" role="menu">
          <div className="tc-me-menu-sec">Status</div>
          {CHOICES.map(([st, label]) => (
            <button key={st} className="tc-menu-item" role="menuitemradio" aria-checked={status === st} onClick={() => choose(st)}>
              <span className={"tc-me-dot is-" + st.toLowerCase()} style={{ "--tc-ring": STATUS_COLOR[st] } as CSSProperties} />
              <span className="tc-me-menu-label">{label}</span>
              {status === st ? <Check size={14} /> : null}
            </button>
          ))}
          <button className="tc-menu-item" onClick={() => choose("Reset")}>
            <RotateCcw size={14} />
            <span className="tc-me-menu-label">Reset status</span>
          </button>
          <div className="tc-me-menu-sep" />
          {noteOpen ? (
            <form className="tc-me-note" onSubmit={(e) => { e.preventDefault(); void saveNote(draft); }}>
              <input
                className="tc-me-note-input"
                autoFocus
                maxLength={280}
                placeholder="Status message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <label className="tc-me-note-row">
                <span>Clear after</span>
                <select value={expiry} onChange={(e) => setExpiry(e.target.value as NoteExpiry)}>
                  {EXPIRY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="tc-me-note-row">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                <span>Show when people message me</span>
              </label>
              <div className="tc-me-note-actions">
                {note ? <button type="button" className="tc-me-note-clear" onClick={() => { setDraft(""); void saveNote(""); }}>Clear</button> : null}
                <button type="submit" className="tc-me-note-save" disabled={!draft.trim()}>Save</button>
              </div>
            </form>
          ) : (
            <button className="tc-menu-item" onClick={() => { setDraft(note?.text || ""); setNoteOpen(true); }}>
              <MessageSquare size={14} />
              <span className="tc-me-menu-label">{note ? "Edit status message" : "Set status message"}</span>
            </button>
          )}
          <div className="tc-me-menu-sep" />
          <button className="tc-menu-item" onClick={() => { setOpen(false); onSwitchToTeams?.(); }}>
            <ArrowLeftRight size={14} />
            <span className="tc-me-menu-label">Switch to Teams</span>
            <span className="tc-me-kb">⌥⌘T</span>
          </button>
        </div>
      ) : null}
      <button
        className={"tc-me-btn" + (open ? " on" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Status and view"
      >
        <Avatar name={name} uri={mri ? avatarUri(mri) : undefined} status={status} />
        <span className="tc-me-text">
          <span className="tc-me-name">{name}</span>
          <span className="tc-me-status">{note ? STATUS_LABEL[status] + " · " + note.text : STATUS_LABEL[status]}</span>
        </span>
        <ChevronUp size={15} className="tc-me-chev" />
      </button>
    </div>
  );
}
