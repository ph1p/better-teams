import type { Quote } from "../../types";

// Teams' native composer is driven with plain text only: it cannot carry a
// quote-reply or @mention entities. Return the reason to refuse the native
// fallback, or null when it would send exactly what the user composed.
export function nativeFallbackBlocker(quote: Quote | null, picks: readonly unknown[]): string | null {
  if (quote) return "fallback-quote";
  if (picks.length) return "fallback-mentions";
  return null;
}
