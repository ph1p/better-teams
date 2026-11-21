// A small, searchable emoji picker. Used by the composer to insert an emoji
// character into the draft (plain text — always safe) and, with a restricted
// set, by the message reaction menu. Keyword search is a tiny built-in index;
// no network, no dependency. Closes on outside click / Escape (handled by the
// caller, which conditionally renders it).
import { useMemo, useRef, useState, type JSX } from "react";
import { t } from "../../i18n";

// [emoji, space-separated keywords]. Kept compact but covering the common set.
// Extend freely — this is plain data.
const EMOJI: ReadonlyArray<readonly [string, string]> = [
  ["👍", "thumbs up yes like approve ok"],
  ["👎", "thumbs down no dislike"],
  ["❤️", "heart love red"],
  ["🧡", "heart orange"],
  ["💛", "heart yellow"],
  ["💚", "heart green"],
  ["💙", "heart blue"],
  ["💜", "heart purple"],
  ["🔥", "fire lit hot flame"],
  ["🎉", "party tada celebrate congrats"],
  ["✅", "check done tick ok yes complete"],
  ["❌", "cross no wrong x"],
  ["⭐", "star favourite"],
  ["💯", "hundred perfect score"],
  ["🙏", "pray thanks please hope"],
  ["👏", "clap applause bravo"],
  ["🙌", "raised hands praise celebrate"],
  ["💪", "muscle strong flex"],
  ["👀", "eyes look watching"],
  ["🚀", "rocket launch ship fast"],
  ["😀", "grin happy smile"],
  ["😄", "happy smile joy"],
  ["😁", "grin beaming"],
  ["😅", "sweat smile nervous laugh"],
  ["😂", "joy laugh crying tears funny"],
  ["🤣", "rofl rolling laughing funny"],
  ["🙂", "smile slight"],
  ["😉", "wink"],
  ["😊", "blush happy smile"],
  ["😍", "heart eyes love"],
  ["😘", "kiss blow"],
  ["😎", "cool sunglasses"],
  ["🤔", "think hmm wondering"],
  ["😐", "neutral meh"],
  ["😴", "sleep tired zzz"],
  ["😢", "sad cry tear"],
  ["😭", "sob crying loud sad"],
  ["😡", "angry mad rage"],
  ["😱", "scream shocked fear"],
  ["😮", "surprised wow shock"],
  ["🤯", "mind blown exploding"],
  ["🥳", "party celebrate hat"],
  ["🤷", "shrug dunno idk"],
  ["👋", "wave hi hello bye"],
  ["🤝", "handshake deal agree"],
  ["💩", "poop crap"],
  ["🎯", "target bullseye goal"],
  ["💡", "idea bulb light"],
  ["⚡", "zap fast power lightning"],
  ["✨", "sparkles shiny new"],
  ["🐛", "bug insect"],
];

interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  className?: string;
}

export function EmojiPicker({ onPick, className }: EmojiPickerProps): JSX.Element {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return EMOJI;
    return EMOJI.filter(([, kw]) => kw.includes(k));
  }, [q]);
  return (
    <div className={"tc-emoji" + (className ? " " + className : "")} onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={input}
        autoFocus
        className="tc-emoji-search"
        placeholder={t().composer.searchEmoji}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && list[0]) {
            e.preventDefault();
            onPick(list[0][0]);
          }
        }}
      />
      <div className="tc-emoji-grid">
        {list.map(([e], i) => (
          <button key={i} type="button" className="tc-emoji-cell" title={e} onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
        {!list.length ? <div className="tc-emoji-empty">{t().composer.noEmoji}</div> : null}
      </div>
    </div>
  );
}
