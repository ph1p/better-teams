// A message's attached files: image thumbnails (from the preview Teams stored)
// and type-colored file cards. Clicking any of them opens the file viewer on
// that file, with the message's other files a ←/→ away.
//
// On your own messages each file has a remove button (shown on hover). The
// first click arms it, a second click within a few seconds removes the file.

import { t } from "../../i18n";
import type { JSX } from "react";
import { ExternalLink, Trash2, X } from "lucide-react";
import { fileItem, KindIcon, openViewer, type ViewerItem } from "../lib/files";
import { useArm } from "../lib/arm";
import type { FileRef } from "../../types";

function RemoveBtn({ name, armed, onClick }: { name: string; armed: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      className={"tc-x-btn tc-attach-x" + (armed ? " armed" : "")}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={armed ? undefined : t().chat.removeFile}
      aria-label={armed ? t().chat.removeFileConfirm(name) : t().common.removeNamed(name)}
    >
      {armed ? <><Trash2 size={13} /> {t().common.remove}</> : <X size={13} />}
    </button>
  );
}

export function Attachments({ files, onRemove }: { files: FileRef[]; onRemove?: (index: number) => void }): JSX.Element | null {
  const { armed, tryArm } = useArm<number>();
  if (!files.length) return null;
  const items = files.map(fileItem);
  const open = (i: number): void => openViewer(items, i);
  const remove = (i: number): void => tryArm(i, () => onRemove?.(i));
  const thumbs: [ViewerItem, number][] = [];
  const cards: [ViewerItem, number][] = [];
  items.forEach((it, i) => (it.image ? thumbs : cards).push([it, i]));
  const single = thumbs.length === 1;

  return (
    <div className="tc-attach">
      {thumbs.length ? (
        <div className={"tc-thumbs" + (single ? " single" : "")}>
          {thumbs.map(([it, i]) => (
            <div key={i} className="tc-thumb-wrap">
              <button className="tc-thumb" onClick={() => open(i)} title={it.name}
                style={single && it.width && it.height ? { aspectRatio: `${it.width} / ${it.height}` } : undefined}>
                <img src={it.image} alt={it.name} loading="lazy" draggable={false} />
              </button>
              {onRemove ? <RemoveBtn name={it.name} armed={armed === i} onClick={() => remove(i)} /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {cards.length ? (
        <div className="tc-cards">
          {cards.map(([it, i]) => (
            <div key={i} className="tc-card">
              <button className="tc-card-main" onClick={() => open(i)} title={t().chat.preview(it.name)}>
                <KindIcon kind={it.kind} className="tc-card-icon" size={18} />
                <span className="tc-card-text">
                  <span className="tc-card-name">{it.name}</span>
                  <span className="tc-card-ext">{it.ext ? it.ext.toUpperCase() : t().chat.file}</span>
                </span>
              </button>
              <span className="tc-card-acts">
                {it.url ? (
                  <a className="tc-card-out" href={it.url} target="_blank" rel="noreferrer noopener" title={t().common.openInBrowser}>
                    <ExternalLink size={14} />
                  </a>
                ) : null}
                {onRemove ? <RemoveBtn name={it.name} armed={armed === i} onClick={() => remove(i)} /> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
