// The file viewer modal: one for the whole app, opened with openViewer().
//
//   image      lightbox; click toggles fit / actual size
//   text       plain text / code fetched and shown as is
//   document   SharePoint's own viewer page in a frame (Office, PDF, video, …)
//   other      type icon and the open / download actions
//
// Esc closes, ←/→ step through the message's files. Keys are caught in the
// capture phase; the app's own shortcuts pause while it is open (viewerOpen).
// A click on the backdrop (outside the picture, frame or bar) closes it.

import { useEffect, useRef, useState, type JSX, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Link2, Check, LoaderCircle, X } from "lucide-react";
import { closeViewer, KindIcon, saveImage, stepViewer, textSrc, useViewer, type ViewerItem } from "../lib/files";
import { useCopied } from "../lib/clipboard";
import { t } from "../../i18n";

function onBackdrop(e: MouseEvent<HTMLDivElement>): void {
  const t = e.target as Element;
  if (t === e.currentTarget || t.classList.contains("tc-viewer-stage")) closeViewer();
}

function meta(it: ViewerItem): string {
  const parts = [it.ext ? it.ext.toUpperCase() : it.image ? t().app.image : ""];
  if (it.width && it.height) parts.push(`${it.width} × ${it.height}`);
  return parts.filter(Boolean).join(" · ");
}

function ImageStage({ item }: { item: ViewerItem }): JSX.Element {
  const [zoom, setZoom] = useState(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <div className={"tc-viewer-stage image" + (zoom ? " zoomed" : "")}>
      {state === "loading" ? <LoaderCircle className="tc-viewer-spin" size={28} /> : null}
      {state === "error" ? <NoPreview item={item} reason={t().app.imageLoadFailed} /> : (
        <img
          src={item.image}
          alt={item.name}
          className={state === "ok" ? "" : "loading"}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          onClick={() => setZoom((z) => !z)}
          title={zoom ? t().app.fitToWindow : t().app.actualSize}
        />
      )}
    </div>
  );
}

function FrameStage({ item }: { item: ViewerItem }): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    // A frame the page's CSP refuses fires no error on the <iframe> itself.
    const onCsp = (e: SecurityPolicyViolationEvent): void => {
      if (item.embed && e.blockedURI && item.embed.startsWith(e.blockedURI)) setBlocked(true);
    };
    document.addEventListener("securitypolicyviolation", onCsp);
    return () => document.removeEventListener("securitypolicyviolation", onCsp);
  }, [item.embed]);
  if (blocked) return <NoPreview item={item} reason={t().app.cantPreview} />;
  return (
    <div className="tc-viewer-stage frame">
      {loaded ? null : <LoaderCircle className="tc-viewer-spin" size={28} />}
      <iframe
        src={item.embed}
        title={item.name}
        className={loaded ? "" : "loading"}
        onLoad={() => setLoaded(true)}
        allow="fullscreen; clipboard-write"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

const TEXT_MAX = 2_000_000;

function TextStage({ item, src }: { item: ViewerItem; src: string }): JSX.Element {
  const [text, setText] = useState<string | null | undefined>(undefined); // null: failed
  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      try {
        const r = await fetch(src, { credentials: "include", signal: ctl.signal });
        // A sign-in or error page instead of the file counts as a failure.
        if (!r.ok || /text\/html/.test(r.headers.get("content-type") || "") && !/^html?$/.test(item.ext)) throw new Error();
        // Stream only the first TEXT_MAX bytes; a huge log is never downloaded whole.
        const parts: BlobPart[] = [];
        let size = 0;
        let more = false;
        const reader = r.body?.getReader();
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          size += value.length;
          if (size > TEXT_MAX) { more = true; void reader.cancel(); break; }
        }
        const body = await new Blob(parts).slice(0, TEXT_MAX).text();
        setText(more ? body + "\n\n" + t().app.textTruncated : body);
      } catch {
        if (!ctl.signal.aborted) setText(null);
      }
    })();
    return () => ctl.abort();
  }, [src, item.ext]);
  if (text === null) return <div className="tc-viewer-stage"><NoPreview item={item} reason={t().app.textLoadFailed} /></div>;
  return (
    <div className="tc-viewer-stage text">
      {text === undefined ? <LoaderCircle className="tc-viewer-spin" size={28} /> : <pre>{text || t().app.emptyFile}</pre>}
    </div>
  );
}

function NoPreview({ item, reason }: { item: ViewerItem; reason?: string }): JSX.Element {
  return (
    <div className="tc-viewer-none">
      <KindIcon kind={item.kind} className="tc-viewer-none-icon" size={40} strokeWidth={1.5} />
      <strong>{item.name}</strong>
      <span>{reason || (item.url || item.download ? t().app.noPreviewType : t().app.noLink)}</span>
      <div className="tc-viewer-none-acts">
        {item.url ? <a className="tc-viewer-cta" href={item.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> {t().common.openInBrowser}</a> : null}
        {item.download ? <a className="tc-viewer-cta ghost" href={item.download} target="_blank" rel="noreferrer noopener"><Download size={14} /> {t().app.download}</a> : null}
      </div>
    </div>
  );
}

export function FileViewer(): JSX.Element | null {
  const v = useViewer();
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [copied, copy] = useCopied();
  const [saving, setSaving] = useState(false);
  const open = !!v;

  // Focus the dialog on open and give focus back to whatever opened it.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    return () => prev?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft") stepViewer(-1);
      else if (e.key === "ArrowRight") stepViewer(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!v) return null;
  const item = v.items[v.index];
  const text = textSrc(item);
  const many = v.items.length > 1;
  const save = (): void => {
    setSaving(true);
    void saveImage(item).finally(() => setSaving(false));
  };

  return (
    <div className="tc-viewer" role="dialog" aria-modal="true" aria-label={item.name} onClick={onBackdrop}>
      <header className="tc-viewer-bar">
        <KindIcon kind={item.kind} className="tc-viewer-icon" size={16} />
        <div className="tc-viewer-title">
          <strong title={item.name}>{item.name}</strong>
          <small>{[meta(item), many ? t().app.nOfM(v.index + 1, v.items.length) : ""].filter(Boolean).join(" · ")}</small>
        </div>
        <div className="tc-viewer-acts">
          {item.download ? (
            <a className="tc-viewer-btn" href={item.download} target="_blank" rel="noreferrer noopener" title={t().app.download}><Download size={17} /></a>
          ) : item.image ? (
            <button className="tc-viewer-btn" onClick={save} disabled={saving} title={t().app.saveImage}>
              {saving ? <LoaderCircle className="tc-viewer-spin inline" size={17} /> : <Download size={17} />}
            </button>
          ) : null}
          {item.url ? (
            <>
              <button className="tc-viewer-btn" onClick={() => copy(item.url!)} title={t().app.copyLink}>{copied ? <Check size={17} /> : <Link2 size={17} />}</button>
              <a className="tc-viewer-btn" href={item.url} target="_blank" rel="noreferrer noopener" title={t().common.openInBrowser}><ExternalLink size={17} /></a>
            </>
          ) : null}
          <span className="tc-viewer-sep" />
          <button ref={closeBtn} className="tc-viewer-btn" onClick={closeViewer} title={t().app.closeEsc}><X size={18} /></button>
        </div>
      </header>

      {/* key: reset zoom/loading state per item */}
      {item.image ? <ImageStage key={v.index + item.image} item={item} />
        : text ? <TextStage key={v.index + text} item={item} src={text} />
        : item.embed ? <FrameStage key={v.index + item.embed} item={item} />
        : <div className="tc-viewer-stage"><NoPreview item={item} /></div>}

      {many ? (
        <>
          <button className="tc-viewer-nav prev" onClick={() => stepViewer(-1)} title={t().app.previous}><ChevronLeft size={22} /></button>
          <button className="tc-viewer-nav next" onClick={() => stepViewer(1)} title={t().app.next}><ChevronRight size={22} /></button>
        </>
      ) : null}
    </div>
  );
}
