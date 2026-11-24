// Bot / connector cards (Jira, Workflows, …). Teams delivers them three ways:
// - RichText/Media_Card content: <URIObject><Swift b64="…"> holding
//   {type:"message/card", attachments:[{contentType, content}]};
// - CDL messages: a `cards` array of {contentType, content (JSON string)};
// - chatsvc REST / IDB: properties.cards, the same array as a JSON string.
// All three end up as Card[] on the message; the UI renders them.
import { isObj, parsed } from "./data/raw";

export interface Card {
  contentType: string;
  content: Record<string, unknown>;
}

function fromList(list: unknown) {
  const out: Card[] = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!isObj(a)) continue;
    const content = parsed(a.content);
    if (!isObj(content)) continue;
    out.push({ contentType: typeof a.contentType === "string" ? a.contentType : "", content });
  }
  return out;
}

function fromSwift(content: string) {
  const m = /<Swift[^>]*\bb64="([^"]+)"/i.exec(content || "");
  if (!m) return [];
  try {
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    const swift = parsed(new TextDecoder().decode(bytes));
    return isObj(swift) ? fromList(swift.attachments) : [];
  } catch {
    return [];
  }
}

export function parseCards(content: string, cards?: unknown) {
  const swift = fromSwift(content);
  return swift.length ? swift : fromList(parsed(cards));
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function plainCardText(s: string) {
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

function adaptiveTexts(el: unknown, out: string[]): void {
  if (Array.isArray(el)) {
    for (const x of el) adaptiveTexts(x, out);
    return;
  }
  if (!isObj(el) || el.isVisible === false) return;
  if (el.type === "TextBlock" || el.type === "TextRun") out.push(str(el.text));
  else if (el.type === "RichTextBlock") adaptiveTexts(el.inlines, out);
  else if (el.type === "FactSet")
    for (const f of Array.isArray(el.facts) ? el.facts : [])
      out.push(`${str(get(f, "title"))} ${str(get(f, "value"))}`);
  for (const k of ["body", "items", "columns", "rows", "cells"]) adaptiveTexts(el[k], out);
}

const get = (o: unknown, k: string) => (isObj(o) ? o[k] : undefined);

export function cardSummary(cards: readonly Card[]) {
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
