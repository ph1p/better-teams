// @mention support for the plain-text composer.
//
// The composer holds plain text. A mention is inserted as literal `@Display Name`
// and remembered here as a MentionPick ({ mri, name, mentionType }). At send time
// formatMessage (markdown.ts) walks the raw draft, turns each still-present `@Display Name`
// run into the exact native Teams mention span, HTML-escapes everything else, and
// returns the paragraph HTML plus the properties.mentions JSON array.
//
// Native format verified from Teams' IndexedDB (replychain-manager/replychains):
//   content span: <span itemtype="http://schema.skype.com/Mention" itemscope itemid="N">Name</span>
//   mentions entry: {"@type":"http://schema.skype.com/Mention","itemid":N,
//                    "mri":"8:orgid:<guid>","mentionType":"person","displayName":"Name"}
// itemid is the 0-based index into the mentions array; the span's itemid matches it.

export interface MentionPick {
  mri: string;
  name: string;
  /** "person" for a user, "channel"/"tag" for others. Composer only inserts "person". */
  mentionType: string;
}

export function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface MentionContent {
  /** Inner HTML for the <p> body: escaped text with mention spans spliced in. */
  html: string;
  /** JSON string for payload.properties.mentions ("[]" when none). */
  mentions: string;
}

export interface MentionSpan {
  start: number;
  end: number;
  pick: MentionPick;
}

// Find which `@Name` runs in the text become mentions. A pick is only claimed
// if its literal `@Name` still occurs in the text (so deleting the text removes
// the mention). Each text occurrence is consumed once, longest names first so
// "@Ann Lee" wins over "@Ann". Spans come back in document order.
export function claimMentions(text: string, picks: readonly MentionPick[]): MentionSpan[] {
  if (!picks.length) return [];
  // Longest display name first; keep original order as tiebreak for stable itemids.
  const ordered = picks.map((p, i) => ({ p, i })).sort((a, b) => b.p.name.length - a.p.name.length || a.i - b.i);
  const spans: MentionSpan[] = [];
  const taken: boolean[] = Array.from({ length: text.length }, () => false);
  for (const { p } of ordered) {
    const token = "@" + p.name;
    let from = 0;
    while (from <= text.length) {
      const at = text.indexOf(token, from);
      if (at < 0) break;
      const end = at + token.length;
      // Skip if any char already claimed by another (longer) mention.
      let free = true;
      for (let j = at; j < end; j++)
        if (taken[j]) {
          free = false;
          break;
        }
      if (free) {
        for (let j = at; j < end; j++) taken[j] = true;
        spans.push({ start: at, end, pick: p });
        break; // one mention per pick entry
      }
      from = end;
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** The native mention span for itemid `idx`. */
export function mentionSpan(idx: number, name: string): string {
  return `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${idx}">${escText(name)}</span>`;
}

/** One properties.mentions entry (JSON) for itemid `idx`. */
export function mentionEntry(idx: number, pick: MentionPick): string {
  return JSON.stringify({
    "@type": "http://schema.skype.com/Mention",
    itemid: idx,
    mri: pick.mri,
    mentionType: pick.mentionType || "person",
    displayName: pick.name,
  });
}

// Turn the plain draft + the picks the user made into send-ready content:
// escaped text with mention spans spliced in, itemids in document order.
export function buildMentionContent(text: string, picks: readonly MentionPick[]): MentionContent {
  const spans = claimMentions(text, picks);
  if (!spans.length) return { html: escText(text), mentions: "[]" };
  let html = "";
  let cursor = 0;
  const entries: string[] = [];
  spans.forEach((s, idx) => {
    html += escText(text.slice(cursor, s.start)) + mentionSpan(idx, s.pick.name);
    cursor = s.end;
    entries.push(mentionEntry(idx, s.pick));
  });
  html += escText(text.slice(cursor));
  return { html, mentions: "[" + entries.join(",") + "]" };
}
