import { useCallback, useEffect, useRef, useState, type JSX, type CSSProperties } from "react";
import {
  ArrowLeftRight,
  Check,
  CircleArrowUp,
  Copy,
  RotateCcw,
  ChevronUp,
  MessageSquare,
  Settings,
} from "lucide-react";
import { myMri, profile } from "../../teamsData";
import { myNote, setMyNote, setMyStatus, type NoteExpiry, type SettableStatus } from "../../status";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { t } from "../../i18n";
import { SettingsModal } from "./SettingsModal";
import { UPDATE_CMD, checkForUpdate, releaseUrl, useUpdate } from "../../update";
import { useCopied } from "../lib/clipboard";
import { Select } from "../shared/Select";
import { STATUS_COLOR, statusLabel, setSelfPresence, usePresence, type Status } from "../lib/presence";

// lucide-react 1.x dropped brand icons; inline GitHub's octicon mark instead.
const GithubMark = ({ size }: { size: number }): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const CHOICES: Exclude<SettableStatus, "Reset">[] = [
  "Available",
  "Busy",
  "DoNotDisturb",
  "BeRightBack",
  "Away",
  "Offline",
];

/** A status choice's label: Teams says "Appear away/offline" for the two you only pretend. */
const choiceLabel = (st: Exclude<SettableStatus, "Reset">): string =>
  st === "Away" ? t().sidebar.appearAway : st === "Offline" ? t().sidebar.appearOffline : statusLabel(st);

const EXPIRY: NoteExpiry[] = ["never", "1h", "4h", "today", "week"];

interface MeBarProps {
  compact: boolean;
  onCompact: (compact: boolean) => void;
  onSwitchToTeams?: () => void;
  onError?: (msg: string) => void;
}

// Sidebar footer: the signed-in user with their presence, plus a menu to change
// status (REST when possible, else Teams' own profile menu), to set a status
// message, and to switch to the native Teams UI underneath.
export function MeBar({ compact, onCompact, onSwitchToTeams, onError }: MeBarProps): JSX.Element {
  const { statusOf, self } = usePresence();
  const [open, setOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [expiry, setExpiry] = useState<NoteExpiry>("today");
  const [pinned, setPinned] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const [, rerender] = useState(0);
  const update = useUpdate();
  const [copied, copy] = useCopied();
  const note = myNote();
  const box = useRef<HTMLDivElement>(null);
  const mri = myMri();
  const p = mri ? profile(mri) : null;
  const s = t().sidebar;
  const name = (p && p.displayName) || t().common.you;
  const own = self();
  const status: Status = own !== "Unknown" ? own : statusOf(mri);

  // Throttled to one request a day inside; the timer covers a Teams window left open for days.
  useEffect(() => {
    void checkForUpdate();
    const id = setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // The note editor closes with the menu.
  if (!open && noteOpen) setNoteOpen(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
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
      onError?.(t().sidebar.statusError(r.reason));
    }
  };

  const saveNote = async (text: string): Promise<void> => {
    const r = await setMyNote(text, expiry, pinned);
    if (!r.ok) {
      onError?.(t().sidebar.noteError(r.reason));
      return;
    }
    setOpen(false);
    rerender((n) => n + 1);
  };

  const row = (inCard: boolean) => (
    <button
      className={"tc-me-btn" + (open ? " on" : "")}
      onClick={() => setOpen((o) => !o)}
      aria-haspopup="menu"
      aria-expanded={open}
      title={s.statusAndView}
      tabIndex={open && !inCard ? -1 : undefined}
      autoFocus={inCard}
    >
      <Avatar name={name} uri={mri ? avatarUri(mri) : undefined} status={status} />
      <span className="tc-me-text">
        <span className="tc-me-name">{name}</span>
        <span className="tc-me-status">{note ? statusLabel(status) + " · " + note.text : statusLabel(status)}</span>
      </span>
      {update && !open ? <span className="tc-me-update-dot" title={s.updateAvailable(update)} /> : null}
      <ChevronUp size={15} className="tc-me-chev" />
    </button>
  );

  return (
    <div className={"tc-me" + (open ? " open" : "")} ref={box}>
      {open ? (
        <div className="tc-me-menu" role="menu">
          <div className="tc-menu-label">{s.statusHeading}</div>
          {CHOICES.map((st) => (
            <button
              key={st}
              className="tc-menu-item"
              role="menuitemradio"
              aria-checked={status === st}
              onClick={() => choose(st)}
            >
              <span
                className={"tc-me-dot is-" + st.toLowerCase()}
                style={{ "--tc-ring": STATUS_COLOR[st] } as CSSProperties}
              />
              <span className="tc-me-menu-label">{choiceLabel(st)}</span>
              {status === st ? <Check size={14} /> : null}
            </button>
          ))}
          <button className="tc-menu-item" role="menuitem" onClick={() => choose("Reset")}>
            <RotateCcw size={14} />
            <span className="tc-me-menu-label">{s.resetStatus}</span>
          </button>
          <div className="tc-menu-sep" />
          {noteOpen ? (
            <form
              className="tc-me-note"
              onSubmit={(e) => {
                e.preventDefault();
                void saveNote(draft);
              }}
            >
              <input
                className="tc-me-note-input"
                autoFocus
                maxLength={280}
                placeholder={s.statusMessage}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <label className="tc-me-note-row">
                <span>{s.clearAfter}</span>
                <Select value={expiry} onChange={(e) => setExpiry(e.target.value as NoteExpiry)}>
                  {EXPIRY.map((k) => (
                    <option key={k} value={k}>
                      {s.expiry[k]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="tc-me-note-row">
                <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
                <span>{s.showWhenMessaged}</span>
              </label>
              <div className="tc-me-note-actions">
                {note ? (
                  <button
                    type="button"
                    className="tc-me-note-clear"
                    onClick={() => {
                      setDraft("");
                      void saveNote("");
                    }}
                  >
                    {t().common.clear}
                  </button>
                ) : null}
                <button type="submit" className="tc-me-note-save" disabled={!draft.trim()}>
                  {t().common.save}
                </button>
              </div>
            </form>
          ) : (
            <button
              className="tc-menu-item"
              role="menuitem"
              onClick={() => {
                setDraft(note?.text || "");
                setNoteOpen(true);
              }}
            >
              <MessageSquare size={14} />
              <span className="tc-me-menu-label">{note ? s.editStatusMessage : s.setStatusMessage}</span>
            </button>
          )}
          <div className="tc-menu-sep" />
          <button
            className="tc-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          >
            <Settings size={14} />
            <span className="tc-me-menu-label">{t().common.settings}…</span>
          </button>
          <button
            className="tc-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSwitchToTeams?.();
            }}
          >
            <ArrowLeftRight size={14} />
            <span className="tc-me-menu-label">{s.switchToTeams}</span>
            <span className="tc-me-kb">⌥⌘T</span>
          </button>
          <div className="tc-menu-sep" />
          {update ? (
            <div className="tc-me-update">
              <div className="tc-me-update-head">
                <CircleArrowUp size={14} />
                <span>{s.updateAvailable(update)}</span>
              </div>
              <button className="tc-me-update-cmd" onClick={() => copy(UPDATE_CMD)} title={s.updateCopy}>
                <code>{UPDATE_CMD}</code>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <div className="tc-me-update-hint">
                <span>{s.updateHint}</span>
                <a href={releaseUrl(update)} target="_blank" rel="noreferrer noopener" onClick={() => setOpen(false)}>
                  {s.updateNotes}
                </a>
              </div>
            </div>
          ) : null}
          <div className="tc-me-about">
            <span className="tc-me-about-ver">
              Better Teams {__VERSION__}
              <a
                href="https://github.com/ph1p/better-teams"
                target="_blank"
                rel="noreferrer noopener"
                title={s.sourceOnGitHub}
                aria-label={s.sourceOnGitHub}
                onClick={() => setOpen(false)}
              >
                <GithubMark size={13} />
              </a>
            </span>
            <a href="https://ph1p.dev" target="_blank" rel="noreferrer noopener" onClick={() => setOpen(false)}>
              {s.madeBy("ph1p.dev")}
            </a>
          </div>
          {row(true)}
        </div>
      ) : null}
      {row(false)}
      {settingsOpen ? <SettingsModal compact={compact} onCompact={onCompact} onClose={closeSettings} /> : null}
    </div>
  );
}
