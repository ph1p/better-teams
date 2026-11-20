// Reaction emoji: Teams sends a reaction key (`like`, `heart`, …) or a raw
// hex-codepoint key; map the named ones to a glyph, and offer a quick picker.
import type { Reaction } from "../../types";

const REACTION: Record<string, string> = {
  like: "👍", heart: "❤️", laugh: "😆", surprised: "😮", sad: "😢", angry: "😠",
  party: "🎉", fire: "🔥", smile: "🙂", sadface: "😢", yes: "👍", no: "👎",
  check: "✅", clap: "👏", plusone: "👍", star: "⭐", eyes: "👀", rocket: "🚀",
  launch: "🚀", ok: "👌", tongueout: "😛", wink: "😉", cool: "😎", cry: "😢",
  confused: "😕", shocked: "😮", laughing: "😆", love: "😍", pray: "🙏",
  "100": "💯", bomb: "💣", tada: "🎉", thumbsup: "👍", thumbsdown: "👎",
};

// Glyph for a reaction: the named map first, else the key's own decoded glyph
// (reactionsOf already turns a hex-codepoint key into its emoji), else the key.
// Skin-tone variants arrive as `<key>-tone1..5` (e.g. `yes-tone2`): base glyph
// plus the matching Fitzpatrick modifier (U+1F3FB..U+1F3FF).
export const glyphFor = (r: Reaction): string => {
  if (REACTION[r.key]) return REACTION[r.key];
  const tone = /^(.+)-tone([1-5])$/.exec(r.key);
  if (tone && REACTION[tone[1]]) {
    return REACTION[tone[1]].replace(/\uFE0F$/, "") + String.fromCodePoint(0x1f3fa + Number(tone[2]));
  }
  return r.glyph || r.key;
};

// The quick picker shown behind the "＋". Teams' own default emotion set.
export const PICKER: ReadonlyArray<readonly [key: string, glyph: string]> = [
  ["like", "👍"], ["heart", "❤️"], ["laugh", "😆"],
  ["surprised", "😮"], ["sad", "😢"], ["angry", "😠"],
];
