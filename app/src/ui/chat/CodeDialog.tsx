import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, CornerDownLeft, X } from "lucide-react";
import { highlightLines, initHighlighter, onHighlighterReady } from "../../highlight";
import { CODE_LANGS, codeLangId } from "../lib/codeLangs";
import { codeNewline, indent } from "../lib/editKeys";
import { useModalExit } from "../lib/modalExit";
import { read, write } from "../lib/prefs";
import { Select } from "../shared/Select";
import { t } from "../../i18n";

const LAST_LANG = "codeLang";

interface CodeDialogProps {
  /** Block being edited, or the selection to start from. */
  code: string;
  /** Its fence language; null for a new block (the last used one then). */
  lang: string | null;
  onDone: (code: string, lang: string) => void;
  onClose: () => void;
}

// The result goes back into the draft as a ``` fence, so it is sent like a
// typed one (markdown.ts).
export function CodeDialog(p: CodeDialogProps) {
  const { closing, close } = useModalExit(p.onClose);
  const [code, setCode] = useState(p.code);
  const [lang, setLang] = useState(() => (p.lang === null ? read(LAST_LANG, "") : codeLangId(p.lang)));
  const editing = p.lang !== null;
  const ta = useRef<HTMLTextAreaElement>(null);
  const back = useRef<HTMLPreElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const [ready, bump] = useState(0);
  useEffect(() => {
    initHighlighter();
    return onHighlighterReady(() => bump((n) => n + 1));
  }, []);
  useEffect(() => {
    const el = ta.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // `ready` re-runs the highlight once the grammars have loaded.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const tokens = useMemo(() => (lang ? highlightLines(code, lang) : null), [code, lang, ready]);
  const lines = code.split("\n");

  // The textarea scrolls; the highlighted copy and the line numbers follow it.
  const sync = () => {
    const el = ta.current;
    if (!el) return;
    if (back.current) back.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-el.scrollTop}px)`;
  };
  useEffect(sync, [code]);

  const done = () => {
    if (!code.trim()) return;
    write(LAST_LANG, lang);
    p.onDone(code, lang);
    close();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      done();
    } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      codeNewline(el);
    } else if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      indent(el, e.shiftKey);
    } else if ("}])".includes(e.key) && e.key.length === 1 && el.selectionStart === el.selectionEnd) {
      // A closing bracket on an indented, still empty line steps back one level.
      const before = el.value.slice(0, el.selectionStart);
      if (/\n[ \t]+$/.test("\n" + before.slice(before.lastIndexOf("\n") + 1))) indent(el, true);
    }
  };

  const c = t().composer;
  // An unknown fence language stays selectable, so editing keeps it.
  const langs = CODE_LANGS.some(([id]) => id === lang) ? CODE_LANGS : [...CODE_LANGS, [lang, lang] as const];
  const dialog = (
    <div
      className={"tc-scrim" + (closing ? " out" : "")}
      // A portal still bubbles React events to the editor's parents (e.g. a message row).
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="tc-newchat tc-codedlg" role="dialog" aria-label={c.codeTitle}>
        <div className="tc-newchat-head">
          <span>{editing ? c.codeEditTitle : c.codeTitle}</span>
          <span className="tc-codedlg-tools">
            <Select value={lang} onChange={(e) => setLang(e.target.value)} aria-label={c.codeLanguage}>
              {langs.map(([id, label]) => (
                <option key={id} value={id}>
                  {id ? label : c.codePlain}
                </option>
              ))}
            </Select>
            <button className="tc-profile-close" onClick={close} title={t().common.close} aria-label={t().common.close}>
              <X size={16} />
            </button>
          </span>
        </div>
        <div className={"tc-codedlg-box" + (tokens ? " tc-shiki" : "")}>
          <div className="tc-codedlg-gutter" aria-hidden>
            <div ref={gutter}>
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          </div>
          <div className="tc-codedlg-field">
            <pre className="tc-codedlg-hl" ref={back} aria-hidden>
              {tokens
                ? tokens.map((line, i) => (
                    <span key={i}>
                      {line.map((tk, j) => (
                        <span key={j} style={tk.color ? { color: tk.color } : undefined}>
                          {tk.content}
                        </span>
                      ))}
                      {"\n"}
                    </span>
                  ))
                : code + "\n"}
            </pre>
            <textarea
              ref={ta}
              value={code}
              wrap="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={c.codePlaceholder}
              aria-label={c.codeTitle}
              onChange={(e) => setCode(e.target.value)}
              onScroll={sync}
              onKeyDown={onKey}
            />
          </div>
        </div>
        <div className="tc-codedlg-foot">
          <span className="tc-edit-hint">{c.codeHint}</span>
          <button className="tc-edit-btn" onClick={close}>
            {t().common.cancel}
            <kbd>Esc</kbd>
          </button>
          <button className="tc-edit-btn primary" onClick={done} disabled={!code.trim()}>
            <Check size={13} />
            {editing ? t().common.save : c.codeInsert}
            <kbd>
              ⌘<CornerDownLeft size={11} />
            </kbd>
          </button>
        </div>
      </div>
    </div>
  );
  const root = document.getElementById("tc-root");
  return root ? createPortal(dialog, root) : dialog;
}
