// Teams enforces a Trusted Types CSP that forbids creating any policy, which
// makes EVERY html-string -> DOM sink throw: innerHTML, DOMParser.parseFromString,
// Range.createContextualFragment, template.innerHTML, iframe.srcdoc. So nothing
// here turns message HTML into nodes: htmlToText reduces it to plain text with
// string ops only, and richText.tsx renders structure as React elements.

import { profile, profilePhotoUrl } from "../../teamsData";
import type { Chat, Message } from "../../types";
import { locale, t } from "../../i18n";
import { nameFormat, personName, shortName } from "../../names";
import { cardSummary } from "../../cards";

export const isDirect = (c: Chat) => c.kind === "chat" && !c.group && !c.app;

/** A chat's display name. The data layer keeps "Notes" untranslated; the UI shows it in the current language. */
export function chatTitle(c: Chat) {
  if (c.kind === "notes") return t().common.notes;
  if (!c.nameTitle || nameFormat() === "teams") return c.title;
  if (c.avatarMri) return personName(profile(c.avatarMri), c.title, c.avatarMri);
  // A group: the first 3 named members, like the data layer builds it.
  const named = c.members.map((m) => profile(m)).filter((p) => p.displayName);
  if (!named.length) return c.title;
  const shown = named.slice(0, 3).map(shortName).join(", ");
  return named.length > 3 ? `${shown} +${named.length - 3}` : shown;
}

export function initials(name: string) {
  const parts = (name || "?")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

export function hue(name: string) {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

// Intl formatters are costly to build and these run for every row and
// message on each poll, so they are built once per locale.
function formatters(loc: string) {
  return {
    loc,
    clock: new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit" }),
    gutter: new Intl.DateTimeFormat(loc, { hour: "numeric", minute: "2-digit" }),
    weekday: new Intl.DateTimeFormat(loc, { weekday: "short" }),
    dayMonth: new Intl.DateTimeFormat(loc, { day: "2-digit", month: "2-digit" }),
    long: new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long" }),
    longYear: new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    stamp: new Intl.DateTimeFormat(loc, { dateStyle: "short", timeStyle: "short" }),
    full: new Intl.DateTimeFormat(loc, { dateStyle: "medium", timeStyle: "medium" }),
    rel: new Intl.RelativeTimeFormat(loc, { numeric: "auto" }),
  };
}
let fmts = formatters(locale());
const fmt = () => (fmts.loc === locale() ? fmts : (fmts = formatters(locale())));

export function fmtTime(ts: number) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmt().clock.format(d);
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 7) return fmt().weekday.format(d);
  return fmt().dayMonth.format(d);
}

export const fmtClock = (ts: number) => (ts ? fmt().clock.format(ts) : "");
// The narrow avatar gutter of follow-up messages has no room for "AM"/"PM":
// "4:58" instead of "04:58 PM". The header above already shows the full time.
// formatToParts allocates per call and every follow-up message renders one on
// each poll, so results are kept per minute until the locale changes.
let gutterFor: ReturnType<typeof formatters> | null = null;
const gutterCache = new Map<number, string>();
export function fmtGutterClock(ts: number) {
  if (!ts) return "";
  const f = fmt();
  if (gutterFor !== f || gutterCache.size > 500) {
    gutterFor = f;
    gutterCache.clear();
  }
  const minute = Math.floor(ts / 60_000);
  let s = gutterCache.get(minute);
  if (s === undefined) {
    s = f.gutter
      .formatToParts(ts)
      .filter((p) => p.type === "hour" || p.type === "minute" || (p.type === "literal" && p.value.trim()))
      .map((p) => p.value)
      .join("");
    gutterCache.set(minute, s);
  }
  return s;
}

/** Short date + time ("23.11.26, 19:32"), as Teams shows on forwarded messages. */
export const fmtStamp = (ts: number) => (ts ? fmt().stamp.format(ts) : "");
export const fmtFull = (ts: number) => (ts ? fmt().full.format(ts) : "");

export function fmtDay(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  // Locale-aware "today"/"yesterday" so labels match the dates around them.
  const f = fmt();
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (d.toDateString() === now.toDateString()) return cap(f.rel.format(0, "day"));
  if (d.toDateString() === yest.toDateString()) return cap(f.rel.format(-1, "day"));
  return (d.getFullYear() === now.getFullYear() ? f.long : f.longYear).format(d);
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  times: "×",
  copy: "©",
  reg: "®",
};
function decodeEntities(s: string) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => (n in ENTITIES ? ENTITIES[n] : m));
}

export function htmlToText(html: string) {
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
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export const oneLine = (html: string) => htmlToText(html).replace(/\s+/g, " ").trim();

export function messageText(m: Message) {
  const cards = m.cards?.length ? cardSummary(m.cards) : "";
  if (/Media_Card/i.test(m.messageType)) return cards || t().sidebar.card;
  if (/^RichText\/Media_/i.test(m.messageType)) return "[" + m.messageType.split("_").pop() + "]";
  return htmlToText(m.content) || cards;
}

// Prefer a cached imageUri from the profile row; fall back to the live Teams
// profile-photo endpoint (cookie-auth). Empty MRI → no photo, initials shown.
export function avatarUri(mri: string) {
  if (!mri) return "";
  return profile(mri).imageUri || profilePhotoUrl(mri);
}

// RichText/Html (and plain Text) carry real message HTML we render structurally;
// cards and media messages have no renderable HTML, so fall back to a label.
export const isHtmlMsg = (m: Message) =>
  /^(RichText\/Html|Text)$/i.test(m.messageType) ||
  (!/Media_|Card|UriObject/i.test(m.messageType) && /<[a-z]/i.test(m.content || ""));
