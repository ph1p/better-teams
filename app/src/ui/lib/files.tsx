import { useSyncExternalStore } from "react";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from "lucide-react";
import type { FileRef } from "../../types";
import { t } from "../../i18n";
import { isTrustedImgHost } from "../../safeUrl";

type FileKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "code"
  | "archive"
  | "text"
  | "other";

const KINDS: [FileKind, RegExp][] = [
  ["image", /^(png|jpe?g|gif|webp|bmp|svg|heic|tiff?)$/],
  ["video", /^(mp4|mov|m4v|webm|avi|mkv)$/],
  ["audio", /^(mp3|m4a|wav|ogg|aac|flac)$/],
  ["pdf", /^pdf$/],
  ["word", /^(docx?|odt|rtf)$/],
  ["excel", /^(xlsx?|xlsm|csv|ods)$/],
  ["powerpoint", /^(pptx?|odp|key)$/],
  ["code", /^(js|jsx|ts|tsx|json|ya?ml|xml|html?|css|sh|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|cs|sql|toml|ini)$/],
  ["archive", /^(zip|tar|gz|tgz|7z|rar)$/],
  ["text", /^(txt|md|log)$/],
];

export function fileKind(ext: string) {
  const e = ext.toLowerCase();
  return KINDS.find(([, re]) => re.test(e))?.[0] ?? "other";
}

const KIND_ICON: Record<FileKind, LucideIcon> = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  pdf: FileText,
  word: FileText,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  code: FileCode,
  archive: FileArchive,
  text: FileText,
  other: File,
};

export interface ViewerItem {
  name: string;
  ext: string;
  kind: FileKind;
  /** Image to show in the lightbox. */
  image?: string;
  width?: number;
  height?: number;
  /** Framed preview page (SharePoint embed). */
  embed?: string;
  /** Open in the browser. */
  url?: string;
  download?: string;
}

interface ViewerState {
  items: ViewerItem[];
  index: number;
}

let state: ViewerState | null = null;
const subs = new Set<() => void>();

function set(next: ViewerState | null) {
  state = next;
  subs.forEach((f) => f());
}

export function openViewer(items: ViewerItem[], index = 0) {
  if (items.length) set({ items, index: Math.max(0, Math.min(index, items.length - 1)) });
}

export function closeViewer() {
  set(null);
}

export function stepViewer(delta: number) {
  if (!state) return;
  const n = state.items.length;
  set({ ...state, index: (state.index + delta + n) % n });
}

/** The app's own shortcuts pause while the viewer is open. */
export const viewerOpen = () => state !== null;

export function useViewer() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

/** Save an image through the page's own session (AMS answers only with Teams' cookies). */
export async function saveImage(item: ViewerItem) {
  if (!item.image) return false;
  try {
    const r = await fetch(item.image, { credentials: isTrustedImgHost(item.image) ? "include" : "omit" });
    if (!r.ok) return false;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const ext = item.ext || (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    a.download = /\.\w+$/.test(item.name) ? item.name : `${item.name}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return true;
  } catch {
    return false;
  }
}

const TEXTY = new Set<FileKind>(["text", "code"]);

/**
 * Where to fetch a plain-text file's content for the viewer, if anywhere:
 * SharePoint's download link, or a local blob (a file still being sent).
 * The share link `url` is SharePoint's HTML page, not the content.
 */
export function textSrc(it: ViewerItem) {
  if (!TEXTY.has(it.kind)) return undefined;
  return it.download || (it.url?.startsWith("blob:") ? it.url : undefined);
}

export function fileItem(f: FileRef): ViewerItem {
  const kind = fileKind(f.ext);
  const image = kind === "image" && f.preview ? f.preview.url : undefined;
  return {
    name: f.name,
    ext: f.ext,
    kind,
    image,
    width: f.preview?.width,
    height: f.preview?.height,
    // Images show the AMS picture, plain text its own content (SharePoint's
    // viewer renders .txt as a blank page); everything else SharePoint's viewer.
    embed: image || TEXTY.has(kind) ? undefined : f.embed,
    url: f.url || undefined,
    download: f.download,
  };
}

/** An inline message image: show Teams' original size (/views/imgo) rather than a thumbnail view. */
export function imageItem(src: string, alt: string, link?: string): ViewerItem {
  const full = src.replace(/\/views\/imgt\w*(?=$|[?#])/, "/views/imgo");
  // No `url` for AMS images: they need Teams' cookies, an external browser
  // would get a 401. A pasted image link (`link`) is public, so it gets one.
  const item: ViewerItem = {
    name: alt && !/^image$/i.test(alt) ? alt : t().app.image,
    ext: "",
    kind: "image",
    image: full,
  };
  if (link) item.url = link;
  return item;
}

export function KindIcon({
  kind,
  className,
  size,
  strokeWidth,
}: {
  kind: FileKind;
  className: string;
  size: number;
  strokeWidth?: number;
}) {
  const Icon = KIND_ICON[kind];
  return (
    <span className={className + " k-" + kind}>
      <Icon size={size} strokeWidth={strokeWidth} />
    </span>
  );
}
