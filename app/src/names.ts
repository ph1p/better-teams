// How people's names are shown. Display only: outbound content (sent messages,
// mentions, quotes) must keep Teams' own displayName and never go through here.
// The format is a global preference, persisted and reactive like the UI language.
import { useSyncExternalStore } from "react";
import { isAppMri } from "./apps";
import type { Profile } from "./types";
import { read, write } from "./ui/lib/prefs";

export type NameFormat = "teams" | "first" | "first-last" | "last-first" | "first-initial";
export const NAME_FORMATS: NameFormat[] = ["teams", "first", "first-last", "last-first", "first-initial"];

interface NameParts {
  displayName?: string;
  givenName?: string;
  surname?: string;
}

/** null when the split cannot be done safely. */
export function splitName(p: NameParts) {
  const given = (p.givenName ?? "").trim();
  const sur = (p.surname ?? "").trim();
  if (given && sur) return { first: given, last: sur };
  const name = (p.displayName ?? "")
    .trim()
    .replace(/\s*(\([^)]*\)|\[[^\]]*\])$/, "")
    .trim();
  const commas = name.split(",");
  if (commas.length === 2) {
    const last = commas[0].trim();
    const first = commas[1].trim();
    return first && last ? { first, last } : null;
  }
  if (commas.length > 2) return null;
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 2) return { first: words[0], last: words[1] };
  return null;
}

export function formatName(p: NameParts, fmt: NameFormat) {
  const raw = p.displayName ?? "";
  if (fmt === "teams") return raw;
  const parts = splitName(p);
  if (!parts) return raw;
  const { first, last } = parts;
  switch (fmt) {
    case "first":
      return first;
    case "first-last":
      return `${first} ${last}`;
    case "last-first":
      return `${last} ${first}`;
    case "first-initial":
      return `${first} ${[...last][0].toUpperCase()}.`;
  }
}

let current = readPref();
const subs = new Set<() => void>();

function readPref(): NameFormat {
  const v = read<unknown>("nameFormat", "teams");
  return NAME_FORMATS.includes(v as NameFormat) ? (v as NameFormat) : "teams";
}

export const nameFormat = () => current;

export function setNameFormat(f: NameFormat) {
  current = f;
  write("nameFormat", f);
  for (const fn of subs) fn();
}

const subscribe = (fn: () => void): (() => void) => {
  subs.add(fn);
  return () => subs.delete(fn);
};

/** Memoized components must call it themselves to re-render on a switch. */
export function useNameFormat() {
  return useSyncExternalStore(subscribe, nameFormat, nameFormat);
}

/** For group titles and the typing indicator. */
export function shortName(p: NameParts) {
  if (current === "teams") return (p.displayName ?? "").split(/[\s,]+/)[0];
  return formatName(p, current);
}

/** Apps and bots are never reformatted. */
export function personName(p: Profile | undefined, raw: string, mri: string, fmt: NameFormat = current) {
  if (isAppMri(mri) || fmt === "teams") return raw || p?.displayName || "";
  if (p?.displayName) return formatName(p, fmt);
  return formatName({ displayName: raw }, fmt);
}

/** "First Last" regardless of the name format setting (apps keep theirs). */
export const fullName = (p: Profile | undefined, mri: string) => personName(p, "", mri, "first-last");
