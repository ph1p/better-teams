import { useEffect, type JSX, type ReactNode } from "react";
import { Contact, Languages, Rows3, X } from "lucide-react";
import { NAME_FORMATS, nameFormat, setNameFormat, type NameFormat } from "../../names";
import { Select } from "../shared/Select";
import { LANGS, autoLang, langPref, setLangPref, t, type LangPref } from "../../i18n";

interface SettingsModalProps {
  compact: boolean;
  onCompact: (compact: boolean) => void;
  onClose: () => void;
}

// Small settings dialog (language, name format, chat list density), opened from the status menu so
// the menu itself stays short.
export function SettingsModal({ compact, onCompact, onClose }: SettingsModalProps): JSX.Element {
  const c = t().common;
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);

  return (
    <div
      className="tc-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tc-newchat tc-settings" role="dialog" aria-label={c.settings}>
        <div className="tc-newchat-head">
          <span>{c.settings}</span>
          <button className="tc-profile-close" onClick={onClose} title={c.close} aria-label={c.close}>
            <X size={16} />
          </button>
        </div>
        <section className="tc-settings-group" aria-label={c.settingsGeneral}>
          <h3>{c.settingsGeneral}</h3>
          <div className="tc-settings-card">
            <Row icon={<Languages size={15} />} label={c.language} hint={c.languageHint}>
              <Select value={langPref()} onChange={(e) => setLangPref(e.target.value as LangPref)} autoFocus>
                <option value="auto">{c.languageAuto(LANGS.find((l) => l.id === autoLang())!.name)}</option>
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Row>
          </div>
        </section>
        <section className="tc-settings-group" aria-label={c.settingsDisplay}>
          <h3>{c.settingsDisplay}</h3>
          <div className="tc-settings-card">
            <Row icon={<Contact size={15} />} label={c.nameFormat} hint={c.nameFormatHint}>
              <Select value={nameFormat()} onChange={(e) => setNameFormat(e.target.value as NameFormat)}>
                {NAME_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {c.nameFormats[f]}
                  </option>
                ))}
              </Select>
            </Row>
            <Row icon={<Rows3 size={15} />} label={c.chatList} hint={c.chatListHint}>
              <Select
                value={compact ? "compact" : "previews"}
                onChange={(e) => onCompact(e.target.value === "compact")}
              >
                <option value="compact">{c.chatLists.compact}</option>
                <option value="previews">{c.chatLists.previews}</option>
              </Select>
            </Row>
          </div>
        </section>
      </div>
    </div>
  );
}

/** One preference: icon, label with a short hint, and its control on the right. */
function Row({
  icon,
  label,
  hint,
  children,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="tc-settings-row">
      <span className="tc-settings-icon">{icon}</span>
      <span className="tc-settings-text">
        <span className="tc-settings-label">{label}</span>
        <span className="tc-settings-hint">{hint}</span>
      </span>
      {children}
    </label>
  );
}
