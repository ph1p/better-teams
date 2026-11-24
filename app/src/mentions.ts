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
  /** "person" for a user, "channel"/"team"/"tag" for others; mri is then the thread id. */
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

/** A mention as stored on a sent message (properties.mentions or CDL `mentions`). */
export interface MentionRef {
  itemid: number;
  mri: string;
  name: string;
  mentionType: string;
}

/** properties.mentions (JSON string, IDB/REST) or CDL's mention list -> MentionRef[]. */
export function parseMentions(raw: unknown): MentionRef[] {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: MentionRef[] = [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const itemid = Number(o.itemid ?? o.itemId);
    const mri = String(o.mri ?? o.userId ?? "");
    if (!Number.isFinite(itemid) || !mri) continue;
    out.push({ itemid, mri, name: String(o.displayName ?? ""), mentionType: String(o.mentionType || "person") });
  }
  return out;
}

// Re-editing a sent message: its mention spans go back to "@Name" draft text,
// and the picks that make them mentions again on save. Teams' own composer
// stores a person as one span per word ("Maya", "Chen"; consecutive itemids,
// same mri): those merge back into one "@Maya Chen" pick.
export function editMentions(refs: readonly MentionRef[]): {
  mark: (itemid: number, text: string) => string;
  picks: () => MentionPick[];
} {
  const byId = new Map(refs.map((r) => [r.itemid, r]));
  const seen = new Map<number, string>();
  const isPart = (r: MentionRef | undefined): boolean => !!r && !/\s/.test(r.name);
  // A word span continuing the previous itemid's word span for the same person.
  const cont = (id: number): boolean => {
    const r = byId.get(id);
    const prev = byId.get(id - 1);
    return isPart(r) && isPart(prev) && prev!.mri === r!.mri;
  };
  return {
    mark: (id, text) => {
      if (!byId.has(id)) return text;
      seen.set(id, text);
      return cont(id) ? text : "@" + text;
    },
    picks: () => {
      const out: MentionPick[] = [];
      for (const r of [...refs].sort((a, b) => a.itemid - b.itemid)) {
        const name = (seen.get(r.itemid) ?? r.name).trim();
        if (!name) continue;
        const last = out[out.length - 1];
        if (last && cont(r.itemid)) last.name += " " + name;
        else out.push({ mri: r.mri, name, mentionType: r.mentionType });
      }
      return out;
    },
  };
}
