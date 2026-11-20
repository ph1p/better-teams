import { profile } from "../../teamsData";
import type { Chat } from "../../types";

// One sidebar group as built by buildSections; rendered by <Section>.
export interface SideSection {
  id: string;
  title: string;
  rows: Chat[];
  capped?: boolean;
  groupByTeam?: boolean;
  defaultCollapsed?: boolean;
}

// Unread filter: chats opened during this filter session stay listed (keep)
// even once read, so the open chat never vanishes; leaving the filter drops them.
export function buildSections(chats: Chat[], query: string, unreadOnly: boolean, keep: ReadonlySet<string>): SideSection[] {
  const q = query.toLowerCase().trim();
  if (q) {
    // Search: one flat result list, best matches first (title before team /
    // member names). Hidden chats are found too.
    const hay = (c: Chat): string =>
      (c.team + " " + c.members.map((m) => profile(m).displayName).join(" ")).toLowerCase();
    const byTitle = chats.filter((c) => c.title.toLowerCase().includes(q));
    const byOther = chats.filter((c) => !c.title.toLowerCase().includes(q) && hay(c).includes(q));
    const list = [...byTitle, ...byOther];
    return list.length ? [{ id: "search", title: "", rows: list, capped: false }] : [];
  }
  // Hidden chats leave the list, as in Teams; search still finds them.
  const list = chats.filter((c) => !c.hidden && (!unreadOnly || c.unread || keep.has(c.id)));
  if (unreadOnly) {
    // Unread filter: one flat inbox, newest first; headers would only repeat
    // the filter's own count.
    return list.length ? [{ id: "unread", title: "", rows: list, capped: false }] : [];
  }
  // The self-chat (Notes) lives in its own slot at the bottom of the sidebar,
  // never in a section.
  const pinned = (c: Chat): boolean => c.kind !== "notes" && (c.favorite || c.pinned);
  const rest = list.filter((c) => !pinned(c) && c.kind !== "notes");
  // Channels grouped by team; teams ordered by their latest activity, so the
  // busy team sits on top. Within a team, newest first (list order).
  const channels = rest.filter((c) => c.kind === "channel");
  const teamRank = new Map<string, number>();
  channels.forEach((c, i) => { if (!teamRank.has(c.team)) teamRank.set(c.team, i); });
  channels.sort((a, b) => teamRank.get(a.team)! - teamRank.get(b.team)!);
  return ([
    { id: "fav", title: "Favorites", rows: list.filter(pinned) },
    { id: "dms", title: "Direct messages", rows: rest.filter((c) => c.kind === "chat" && !c.app && c.members.length <= 1) },
    { id: "groups", title: "Groups", rows: rest.filter((c) => c.kind === "chat" && c.members.length > 1) },
    { id: "channels", title: "Channels", rows: channels, groupByTeam: true },
    { id: "apps", title: "Apps", rows: rest.filter((c) => c.app) },
    { id: "meetings", title: "Meetings", rows: rest.filter((c) => c.kind === "meeting"), defaultCollapsed: true },
  ] as SideSection[]).filter((s) => s.rows.length);
}
