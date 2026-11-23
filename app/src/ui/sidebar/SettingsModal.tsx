import { useEffect, type JSX } from "react";
import { Contact, Languages, X } from "lucide-react";
import { NAME_FORMATS, nameFormat, setNameFormat, type NameFormat } from "../../names";
import { LANGS, autoLang, langPref, setLangPref, t, type LangPref } from "../../i18n";

interface SettingsModalProps {
  onClose: () => void;
}

// Small settings dialog (language, name format), opened from the status menu so
// the menu itself stays short.
export function SettingsModal({ onClose }: SettingsModalProps): JSX.Element {
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
        <label className="tc-settings-row">
          <Languages size={15} />
          <span>{c.language}</span>
          <select value={langPref()} onChange={(e) => setLangPref(e.target.value as LangPref)} autoFocus>
            <option value="auto">{c.languageAuto(LANGS.find((l) => l.id === autoLang())!.name)}</option>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tc-settings-row">
          <Contact size={15} />
          <span>{c.nameFormat}</span>
          <select value={nameFormat()} onChange={(e) => setNameFormat(e.target.value as NameFormat)}>
            {NAME_FORMATS.map((f) => (
              <option key={f} value={f}>
                {c.nameFormats[f]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
