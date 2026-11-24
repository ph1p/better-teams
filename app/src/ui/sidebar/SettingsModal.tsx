import { useEffect, useState, type ReactNode } from "react";
import { Contact, Languages, RefreshCw, Rows3, X } from "lucide-react";
import { NAME_FORMATS, nameFormat, setNameFormat, type NameFormat } from "../../names";
import { Select } from "../shared/Select";
import { LANGS, autoLang, langPref, setLangPref, t, type LangPref } from "../../i18n";
import { useModalExit } from "../lib/modalExit";
import { checkForUpdate, setUpdateCheck, updateCheckOn, type UpdateResult } from "../../update";

interface SettingsModalProps {
  compact: boolean;
  onCompact: (compact: boolean) => void;
  onClose: () => void;
}

// Opened from the status menu so the menu itself stays short.
export function SettingsModal({ compact, onCompact, onClose }: SettingsModalProps) {
  const { closing, close } = useModalExit(onClose);
  const c = t().common;
  const [updates, setUpdates] = useState(updateCheckOn);
  const [checked, setChecked] = useState<UpdateResult | "checking" | null>(null);
  const checkNow = () => {
    if (checked === "checking") return;
    setChecked("checking");
    void checkForUpdate(true).then(setChecked);
  };
  const updateHint =
    checked === null
      ? c.updateCheckHint
      : checked === "checking"
        ? c.updateChecking
        : checked.kind === "newer"
          ? c.updateFound(checked.version)
          : checked.kind === "current"
            ? c.upToDate(__VERSION__)
            : c.updateFailed;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [close]);

  return (
    <div
      className={"tc-scrim" + (closing ? " out" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="tc-newchat tc-settings" role="dialog" aria-label={c.settings}>
        <div className="tc-newchat-head">
          <span>{c.settings}</span>
          <button className="tc-profile-close" onClick={close} title={c.close} aria-label={c.close}>
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
            <Row
              icon={<RefreshCw size={15} />}
              label={c.updateCheck}
              hint={
                <>
                  {updateHint}
                  {" · "}
                  {/* A span, not a <button>: the row is a <label>, and a button would become the
                      control the label clicks, so clicking the title would start a check. */}
                  <span
                    role="button"
                    tabIndex={0}
                    className="tc-settings-link"
                    aria-disabled={checked === "checking"}
                    onClick={(e) => {
                      e.preventDefault();
                      checkNow();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        checkNow();
                      }
                    }}
                  >
                    {c.checkNow}
                  </span>
                </>
              }
            >
              <Select
                value={updates ? "on" : "off"}
                onChange={(e) => {
                  const on = e.target.value === "on";
                  setUpdates(on);
                  setUpdateCheck(on);
                }}
              >
                <option value="on">{c.on}</option>
                <option value="off">{c.off}</option>
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

function Row({
  icon,
  label,
  hint,
  children,
}: {
  icon: ReactNode;
  label: string;
  hint: ReactNode;
  children: ReactNode;
}) {
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
