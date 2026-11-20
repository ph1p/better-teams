// A message's attached files: image thumbnails (from the preview Teams stored)
// and type-colored file cards. Clicking any of them opens the file viewer on
// that file, with the message's other files a ←/→ away.

import type { JSX } from "react";
import { ExternalLink } from "lucide-react";
import { fileItem, KindIcon, openViewer, type ViewerItem } from "../lib/files";
import type { FileRef } from "../../types";

export function Attachments({ files }: { files: FileRef[] }): JSX.Element | null {
  if (!files.length) return null;
  const items = files.map(fileItem);
  const open = (i: number): void => openViewer(items, i);
  const thumbs: [ViewerItem, number][] = [];
  const cards: [ViewerItem, number][] = [];
  items.forEach((it, i) => (it.image ? thumbs : cards).push([it, i]));
  const single = thumbs.length === 1;

  return (
    <div className="tc-attach">
      {thumbs.length ? (
        <div className={"tc-thumbs" + (single ? " single" : "")}>
          {thumbs.map(([it, i]) => (
            <button key={i} className="tc-thumb" onClick={() => open(i)} title={it.name}
              style={single && it.width && it.height ? { aspectRatio: `${it.width} / ${it.height}` } : undefined}>
              <img src={it.image} alt={it.name} loading="lazy" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
      {cards.length ? (
        <div className="tc-cards">
          {cards.map(([it, i]) => (
            <div key={i} className="tc-card">
              <button className="tc-card-main" onClick={() => open(i)} title={"Preview " + it.name}>
                <KindIcon kind={it.kind} className="tc-card-icon" size={18} />
                <span className="tc-card-text">
                  <span className="tc-card-name">{it.name}</span>
                  <span className="tc-card-ext">{it.ext ? it.ext.toUpperCase() : "File"}</span>
                </span>
              </button>
              {it.url ? (
                <a className="tc-card-out" href={it.url} target="_blank" rel="noreferrer noopener" title="Open in browser">
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
