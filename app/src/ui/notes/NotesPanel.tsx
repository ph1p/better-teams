import { useEffect, useRef, type JSX } from "react";
import { X } from "lucide-react";
import { usePref } from "../lib/prefs";
import { t } from "../../i18n";

interface NotesPanelProps {
  onClose: () => void;
}

// Pref key of the sheet text (stored as "teams-calm:notes").
const KEY = "notes";

// Right-hand scratchpad drawer. Plain text, saved to localStorage on every
// keystroke and never sent anywhere. Other Teams windows share the same
// storage, so a write there (storage event) replaces the text here unless this
// window is the one being typed in.
export function NotesPanel({ onClose }: NotesPanelProps): JSX.Element {
  const [text, setText] = usePref<string>(KEY, "");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { area.current?.focus(); }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== "teams-calm:" + KEY || e.newValue === null) return;
      if (document.activeElement === area.current) return;
      try { setText(JSON.parse(e.newValue) as string); } catch { /* malformed: ignore */ }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setText]);

  return (
    <aside className="tc-profile tc-notes">
      <div className="tc-notes-head">
        <span className="tc-notes-title">{t().common.notes}</span>
        <button className="tc-profile-close" onClick={onClose} title={t().app.closeNotesTitle} aria-label={t().app.closeNotes}><X size={16} /></button>
      </div>
      <textarea
        ref={area}
        className="tc-notes-area"
        placeholder={t().app.notesPlaceholder}
        value={text}
        spellCheck
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      />
    </aside>
  );
}
