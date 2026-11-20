// The file viewer modal: one for the whole app, opened with openViewer().
//
//   image      lightbox; click toggles fit / actual size
//   document   SharePoint's own viewer page in a frame (Office, PDF, video, …)
//   other      type icon and the open / download actions
//
// Esc closes, ←/→ step through the message's files. Keys are caught in the
// capture phase; the app's own shortcuts pause while it is open (viewerOpen).
// A click on the backdrop (outside the picture, frame or bar) closes it.

import { useEffect, useRef, useState, type JSX, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, Download, ExternalLink, Link2, Check, LoaderCircle, X } from "lucide-react";
import { closeViewer, KindIcon, saveImage, stepViewer, useViewer, type ViewerItem } from "../lib/files";
import { useCopied } from "../lib/clipboard";

function onBackdrop(e: MouseEvent<HTMLDivElement>): void {
  const t = e.target as Element;
  if (t === e.currentTarget || t.classList.contains("tc-viewer-stage")) closeViewer();
}

function meta(it: ViewerItem): string {
  const parts = [it.ext ? it.ext.toUpperCase() : it.image ? "Image" : ""];
  if (it.width && it.height) parts.push(`${it.width} × ${it.height}`);
  return parts.filter(Boolean).join(" · ");
}

function ImageStage({ item }: { item: ViewerItem }): JSX.Element {
  const [zoom, setZoom] = useState(false);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  return (
    <div className={"tc-viewer-stage image" + (zoom ? " zoomed" : "")}>
      {state === "loading" ? <LoaderCircle className="tc-viewer-spin" size={28} /> : null}
      {state === "error" ? <NoPreview item={item} reason="The image could not be loaded." /> : (
        <img
          src={item.image}
          alt={item.name}
          className={state === "ok" ? "" : "loading"}
          onLoad={() => setState("ok")}
          onError={() => setState("error")}
          onClick={() => setZoom((z) => !z)}
          title={zoom ? "Fit to window" : "Actual size"}
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
  if (blocked) return <NoPreview item={item} reason="This file can't be previewed here." />;
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

function NoPreview({ item, reason }: { item: ViewerItem; reason?: string }): JSX.Element {
  return (
    <div className="tc-viewer-none">
      <KindIcon kind={item.kind} className="tc-viewer-none-icon" size={40} strokeWidth={1.5} />
      <strong>{item.name}</strong>
      <span>{reason || (item.url || item.download ? "No preview for this file type." : "Teams shared no link for this file. Open it in Teams.")}</span>
      <div className="tc-viewer-none-acts">
        {item.url ? <a className="tc-viewer-cta" href={item.url} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} /> Open in browser</a> : null}
        {item.download ? <a className="tc-viewer-cta ghost" href={item.download} target="_blank" rel="noreferrer noopener"><Download size={14} /> Download</a> : null}
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
          <small>{[meta(item), many ? `${v.index + 1} of ${v.items.length}` : ""].filter(Boolean).join(" · ")}</small>
        </div>
        <div className="tc-viewer-acts">
          {item.download ? (
            <a className="tc-viewer-btn" href={item.download} target="_blank" rel="noreferrer noopener" title="Download"><Download size={17} /></a>
          ) : item.image ? (
            <button className="tc-viewer-btn" onClick={save} disabled={saving} title="Save image">
              {saving ? <LoaderCircle className="tc-viewer-spin inline" size={17} /> : <Download size={17} />}
            </button>
          ) : null}
          {item.url ? (
            <>
              <button className="tc-viewer-btn" onClick={() => copy(item.url!)} title="Copy link">{copied ? <Check size={17} /> : <Link2 size={17} />}</button>
              <a className="tc-viewer-btn" href={item.url} target="_blank" rel="noreferrer noopener" title="Open in browser"><ExternalLink size={17} /></a>
            </>
          ) : null}
          <span className="tc-viewer-sep" />
          <button ref={closeBtn} className="tc-viewer-btn" onClick={closeViewer} title="Close (Esc)"><X size={18} /></button>
        </div>
      </header>

      {/* key: reset zoom/loading state per item */}
      {item.image ? <ImageStage key={v.index + item.image} item={item} />
        : item.embed ? <FrameStage key={v.index + item.embed} item={item} />
        : <div className="tc-viewer-stage"><NoPreview item={item} /></div>}

      {many ? (
        <>
          <button className="tc-viewer-nav prev" onClick={() => stepViewer(-1)} title="Previous (←)"><ChevronLeft size={22} /></button>
          <button className="tc-viewer-nav next" onClick={() => stepViewer(1)} title="Next (→)"><ChevronRight size={22} /></button>
        </>
      ) : null}
    </div>
  );
}
