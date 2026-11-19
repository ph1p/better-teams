// Pure formatting + text-extraction helpers shared across the overlay UI.
//
// Teams enforces a Trusted Types CSP that forbids creating any policy, which
// makes EVERY html-string -> DOM sink throw: innerHTML, DOMParser.parseFromString,
// Range.createContextualFragment, template.innerHTML, iframe.srcdoc. So nothing
// here turns message HTML into nodes: htmlToText reduces it to plain text with
// string ops only, and richText.tsx renders structure as React elements.

import { profile, profilePhotoUrl } from "../../teamsData";
import type { Message } from "../../types";

export function initials(name: string): string {
  const parts = (name || "?").replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// Stable per-name avatar colour so rows are distinguishable at a glance.
export function hue(name: string): number {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function fmtTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}

export const fmtClock = (ts: number): string =>
  ts ? new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";

export function fmtDay(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  // Locale-aware "today"/"yesterday" so labels match the dates around them.
  const rel = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
  if (d.toDateString() === now.toDateString()) return cap(rel.format(0, "day"));
  if (d.toDateString() === yest.toDateString()) return cap(rel.format(-1, "day"));
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", times: "×", copy: "©", reg: "®",
};
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => (n in ENTITIES ? ENTITIES[n] : m));
}

export function htmlToText(html: string): string {
  if (!html) return "";
  return decodeEntities(
    String(html)
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
      // Teams emoji are <img alt="😀">: keep the emoji.
      .replace(/<img[^>]*\balt="([^"]*)"[^>]*>/gi, "$1")
      // Keep link targets whose visible text hides them.
      .replace(/<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
        const text = inner.replace(/<[^>]+>/g, "").trim();
        const url = decodeEntities(href);
        return !text || text === url || url.startsWith("mailto:") ? text || url : `${text} (${url})`;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export const oneLine = (html: string): string => htmlToText(html).replace(/\s+/g, " ").trim();

// Connector / bot cards: <URIObject …><Swift b64="…">. Show their title+summary.
function cardText(content: string): string {
  const m = /b64="([^"]+)"/.exec(content || "");
  if (!m) return "";
  try {
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const j = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
    const atts = Array.isArray(j.attachments) ? j.attachments : [];
    const c = (atts[0] && typeof atts[0] === "object" ? (atts[0] as Record<string, unknown>).content : {}) as Record<string, unknown>;
    return [c.title, c.summary || j.summary, c.text]
      .filter((v): v is string => typeof v === "string" && !!v)
      .map(htmlToText)
      .join("\n");
  } catch {
    return "";
  }
}

export function messageText(m: Message): string {
  if (/Media_Card/i.test(m.messageType)) return cardText(m.content) || "[Card]";
  if (/^RichText\/Media_/i.test(m.messageType)) return "[" + m.messageType.split("_").pop() + "]";
  return htmlToText(m.content);
}

// Prefer a cached imageUri from the profile row; fall back to the live Teams
// profile-photo endpoint (cookie-auth). Empty MRI → no photo, initials shown.
export function avatarUri(mri: string): string {
  if (!mri) return "";
  return profile(mri).imageUri || profilePhotoUrl(mri);
}

// RichText/Html (and plain Text) carry real message HTML we render structurally;
// cards and media messages have no renderable HTML, so fall back to a label.
export const isHtmlMsg = (m: Message): boolean =>
  /^(RichText\/Html|Text)$/i.test(m.messageType) ||
  (!/Media_|Card|UriObject/i.test(m.messageType) && /<[a-z]/i.test(m.content || ""));
