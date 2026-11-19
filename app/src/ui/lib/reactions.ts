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
export const glyphFor = (r: Reaction): string => REACTION[r.key] || r.glyph || r.key;

// The quick picker shown behind the "＋". Teams' own default emotion set.
export const PICKER: ReadonlyArray<readonly [key: string, glyph: string]> = [
  ["like", "👍"], ["heart", "❤️"], ["laugh", "😆"],
  ["surprised", "😮"], ["sad", "😢"], ["angry", "😠"],
];
