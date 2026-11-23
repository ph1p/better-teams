// Bot / connector cards (Jira, Workflows, …). Teams delivers them three ways:
// - RichText/Media_Card content: <URIObject><Swift b64="…"> holding
//   {type:"message/card", attachments:[{contentType, content}]};
// - CDL messages: a `cards` array of {contentType, content (JSON string)};
// - chatsvc REST / IDB: properties.cards, the same array as a JSON string.
// All three end up as Card[] on the message; the UI renders them.

export interface Card {
  contentType: string;
  content: Record<string, unknown>;
}

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

function json(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function fromList(list: unknown): Card[] {
  const out: Card[] = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!isDict(a)) continue;
    const content = json(a.content);
    if (!isDict(content)) continue;
    out.push({ contentType: typeof a.contentType === "string" ? a.contentType : "", content });
  }
  return out;
}

function fromSwift(content: string): Card[] {
  const m = /<Swift[^>]*\bb64="([^"]+)"/i.exec(content || "");
  if (!m) return [];
  try {
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    const swift = json(new TextDecoder().decode(bytes));
    return isDict(swift) ? fromList(swift.attachments) : [];
  } catch {
    return [];
  }
}

/** Cards of one message: from its Swift content, else from its cards list (array or JSON string). */
export function parseCards(content: string, cards?: unknown): Card[] {
  const swift = fromSwift(content);
  return swift.length ? swift : fromList(json(cards));
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Markdown / HTML / template noise off a card string, for previews and search. */
export function plainCardText(s: string): string {
  return s
    .replace(/\{\{(?:DATE|TIME)\(([^,)]+)[^}]*\}\}/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

// Adaptive Card text in reading order (TextBlocks, TextRuns, facts).
function adaptiveTexts(el: unknown, out: string[]): void {
  if (Array.isArray(el)) {
    for (const x of el) adaptiveTexts(x, out);
    return;
  }
  if (!isDict(el) || el.isVisible === false) return;
  if (el.type === "TextBlock" || el.type === "TextRun") out.push(str(el.text));
  else if (el.type === "RichTextBlock") adaptiveTexts(el.inlines, out);
  else if (el.type === "FactSet")
    for (const f of Array.isArray(el.facts) ? el.facts : [])
      out.push(`${str(get(f, "title"))} ${str(get(f, "value"))}`);
  for (const k of ["body", "items", "columns", "rows", "cells"]) adaptiveTexts(el[k], out);
}

const get = (o: unknown, k: string): unknown => (isDict(o) ? o[k] : undefined);

/** Short text of a card list ("title · line · line"), "" when nothing readable. */
export function cardSummary(cards: readonly Card[]): string {
  const parts: string[] = [];
  for (const { content: c } of cards) {
    if (c.type === "AdaptiveCard" || Array.isArray(c.body)) adaptiveTexts(c.body, parts);
    else {
      parts.push(str(c.title), str(c.subtitle), str(c.summary), str(c.text));
      for (const s of Array.isArray(c.sections) ? c.sections : [])
        parts.push(str(get(s, "activityTitle")), str(get(s, "activityText")), str(get(s, "text")));
    }
  }
  return parts.map(plainCardText).filter(Boolean).slice(0, 3).join(" · ");
}
