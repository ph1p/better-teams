import { htmlToText } from "../lib/format";
import { formatMessage } from "../../markdown";
import type { Message as Msg } from "../../types";

// Plain text without whitespace or "@", for matching a draft to its synced copy.
const bare = (s: string): string => s.replace(/[\s@]+/g, "");
const STALE_PENDING_MS = 15_000;
const CLOCK_SKEW_MS = 5_000;

// An optimistic message shown immediately after sending, before Teams syncs the
// real one back.
export interface Pending {
  key: number;
  chatId: string;
  text: string;
  time: number;
  /** Channel thread it replies in. */
  rootId?: string;
  /** Names of the files it carries. */
  files?: string[];
}

// djb2 string hash: lets the signature notice content changes without keeping a copy of every message's HTML.
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

// Cheap change signature so polling doesn't re-render (and jump) when idle.
export const msgSig = (list: Msg[]): string =>
  list
    .map(
      (m) =>
        `${m.id}:${m.time}:${m.edited}:${m.deleted}:${hash(m.content)}:${m.files.map((f) => f.name).join("/")}:${m.reactions.map((r) => r.key + r.count + (r.mine ? "*" : "")).join()}`,
    )
    .join("|");

// The HTML an edit stores: the same as data/writes.ts editMessage sends.
export const editedContent = (text: string, quoteHtml = ""): string =>
  (quoteHtml || "") + formatMessage(String(text)).html;

// Drop optimistic messages once Teams has synced the real one. The draft is
// markdown and the synced copy HTML, so both go through the same renderer
// and compare as plain text without whitespace or "@"; a suffix match
// allows for the quote Teams puts in front of a reply.
export function prunePending(pending: Pending[], chatId: string, list: Msg[], now: number): Pending[] {
  if (!pending.length) return pending;
  const mine = list.filter((m) => m.mine);
  const texts = mine.map((m) => ({ time: m.time, text: bare(htmlToText(m.content)) }));
  const kept = pending.filter((x) => {
    if (x.chatId !== chatId) return true;
    const s = bare(htmlToText(formatMessage(x.text).html));
    if (s && texts.some((t) => t.time >= x.time - CLOCK_SKEW_MS && t.text.endsWith(s))) return false;
    // A file-only send has no text: match a newer message of mine with the same files.
    const names = x.files || [];
    if (
      !s &&
      names.length &&
      mine.some((m) => m.time >= x.time - CLOCK_SKEW_MS && names.every((n) => m.files.some((f) => f.name === n)))
    )
      return false;
    // Unmatched (rewritten by Teams?): give up once a newer message of mine has synced.
    return !(now - x.time > STALE_PENDING_MS && mine.some((m) => m.time >= x.time - CLOCK_SKEW_MS));
  });
  return kept.length === pending.length ? pending : kept;
}
