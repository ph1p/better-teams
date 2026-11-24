// UI translations. English (./en) is the source: its shape is the `Messages`
// type, and every other language must match it key for key, so a missing or
// extra string fails the typecheck. Strings that take values are functions,
// which keeps plurals and word order in the translation, not in the caller.
//
// The language follows Teams' own UI language (the page's <html lang>), then
// the browser's, unless the user picked one in the status menu. Components read
// strings with t() during render; the app root subscribes with useLang(), so a
// switch re-renders the whole tree (nothing in the UI is memoised).

import { useSyncExternalStore } from "react";
import { en, type Messages } from "./en";
import { de } from "./de";
import { read, write } from "../ui/lib/prefs";

export type { Messages };
export type Lang = "en" | "de";
export type LangPref = Lang | "auto";

const DICTS: Record<Lang, Messages> = { en, de };

/** Languages offered in the picker, each named in itself. */
export const LANGS: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "de", name: "Deutsch" },
];

function readPref() {
  const v = read<unknown>("lang", "auto");
  return v === "en" || v === "de" ? v : "auto";
}

const isLang = (tag: string) => {
  const base = tag.toLowerCase().split(/[-_]/)[0];
  return base in DICTS ? (base as Lang) : null;
};

/** The browser/Teams language tags to try, most specific first. */
function wanted() {
  const page = typeof document !== "undefined" ? document.documentElement.lang : "";
  const nav = typeof navigator !== "undefined" ? [...(navigator.languages ?? []), navigator.language] : [];
  return [page, ...nav].filter(Boolean);
}

function localeFor(l: Lang) {
  return wanted().find((w) => isLang(w) === l) ?? (l === "de" ? "de-DE" : "en-US");
}

function detect() {
  for (const tag of wanted()) {
    const l = isLang(tag);
    if (l) return l;
  }
  return "en";
}

let pref: LangPref = readPref();
let cur = pref === "auto" ? detect() : pref;
let tag = localeFor(cur);
const subs = new Set<() => void>();

/** The active language's strings. */
export const t = (): Messages => DICTS[cur];

export const lang = () => cur;
/** What "automatic" resolves to right now (for the picker's label). */
export const autoLang = () => detect();
export const langPref = () => pref;

/**
 * The BCP 47 tag for Intl date/number formatting: the user's own regional
 * variant when it is in the active language (de-AT, en-GB), else a default.
 * Computed on a language switch, not per call (formatting runs on every poll).
 */
export const locale = () => tag;

export function setLangPref(p: LangPref) {
  pref = p;
  write("lang", p);
  const next = p === "auto" ? detect() : p;
  if (next === cur) return;
  cur = next;
  tag = localeFor(cur);
  for (const fn of subs) fn();
}

const subscribe = (fn: () => void): (() => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

/** Re-render on a language switch. Call once near the root. */
export function useLang() {
  return useSyncExternalStore(subscribe, lang, lang);
}
