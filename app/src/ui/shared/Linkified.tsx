import type { ReactNode } from "react";
import { ImageLink } from "../../richText";
import { isImageUrl } from "../../safeUrl";

// Render plain text with clickable URLs (React text nodes only, no HTML sink).
const URL_RE = /(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?'])/g;

export function Linkified({ text }: { text: string }): ReactNode {
  const parts = text.split(URL_RE);
  return parts.map((p, i) =>
    i % 2 ? (
      isImageUrl(p) ? (
        <ImageLink key={i} href={p} alt="" />
      ) : (
        <a key={i} href={p} target="_blank" rel="noreferrer noopener">
          {p}
        </a>
      )
    ) : (
      p
    ),
  );
}
