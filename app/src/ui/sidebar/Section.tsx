import { useState, type JSX, type MouseEvent } from "react";
import { ChevronDown, ChevronRight, ListChecks, Plus } from "lucide-react";
import { Row } from "./Row";
import { RECENT_MS, SECTION_CAP, SECTION_MIN } from "../lib/constants";
import { usePref } from "../lib/prefs";
import { useNow } from "../lib/now";
import type { Chat } from "../../types";
import { t } from "../../i18n";

interface SectionProps {
  // Stable key for the persisted collapsed state ("dms", "channels", ...).
  id: string;
  title: string;
  rows: Chat[];
  sel: string | null;
  // Keyboard-highlighted row (search arrow keys).
  active?: string | null;
  compact: boolean;
  // false: list every row (Unread filter, search results), no "Show more".
  capped?: boolean;
  // Starts collapsed until the user opens it once (Meetings).
  defaultCollapsed?: boolean;
  // Rows arrive sorted by team; print a small team label above each run.
  groupByTeam?: boolean;
  onPick: (id: string) => void;
  onOpenProfile: (mri: string) => void;
  onMenu: (e: MouseEvent, chat: Chat) => void;
  // With groupByTeam: the label's hover "+" adds a channel to the team of the given row.
  onAddChannel?: (chat: Chat) => void;
  // With groupByTeam: the label's channel button opens the team's show/hide list.
  onTeamChannels?: (e: MouseEvent<HTMLElement>, chat: Chat) => void;
}

// A collapsible sidebar group; an empty title renders the rows alone, without a
// header. A section shows what is current, not everything: at least
// SECTION_MIN rows, then those active within RECENT_MS (up to SECTION_CAP);
// older ones sit behind "Show N older". Unread rows and the open chat always
// show — even in a collapsed section, so collapsing never hides new messages.
export function Section({
  id,
  title,
  rows,
  sel,
  active = null,
  compact,
  capped = true,
  defaultCollapsed = false,
  groupByTeam = false,
  onPick,
  onOpenProfile,
  onMenu,
  onAddChannel,
  onTeamChannels,
}: SectionProps) {
  const [collapsed, setCollapsed] = usePref("sec:" + id, defaultCollapsed);
  const [all, setAll] = useState(false);
  const unread = rows.filter((r) => r.unread).length;
  const open = !collapsed || !title;
  const cutoff = useNow(60_000) - RECENT_MS;
  const shown = !open
    ? rows.filter((r) => r.unread || r.id === sel)
    : all || !capped
      ? rows
      : rows.filter((r, i) => i < SECTION_MIN || (i < SECTION_CAP && r.time >= cutoff) || r.unread || r.id === sel);
  const hidden = rows.length - shown.length;

  const body: JSX.Element[] = [];
  let team: string | null = null;
  for (const c of shown) {
    if (groupByTeam && c.team !== team) {
      team = c.team;
      const name = c.team || t().sidebar.otherTeam;
      body.push(
        <div key={"t:" + c.team} className="tc-team-label">
          <span>{name}</span>
          {onTeamChannels && c.teamId ? (
            <button
              className="tc-team-add tc-team-chans"
              title={t().sidebar.teamChannels}
              aria-label={t().sidebar.teamChannels + ": " + name}
              aria-haspopup="dialog"
              onClick={(e) => onTeamChannels(e, c)}
            >
              <ListChecks size={13} />
            </button>
          ) : null}
          {onAddChannel && c.team ? (
            <button
              className="tc-team-add"
              title={t().chat.newChannel}
              aria-label={t().chat.newChannel + ": " + name}
              onClick={() => onAddChannel(c)}
            >
              <Plus size={13} />
            </button>
          ) : null}
        </div>,
      );
    }
    body.push(
      <Row
        key={c.id}
        chat={c}
        compact={compact}
        showTeam={!groupByTeam}
        selected={c.id === sel}
        active={c.id === active}
        onClick={() => onPick(c.id)}
        onOpenProfile={onOpenProfile}
        onMenu={onMenu}
      />,
    );
  }

  return (
    <div className={"tc-section" + (open ? "" : " collapsed")}>
      {title ? (
        <button className="tc-sec" onClick={() => setCollapsed((c) => !c)} aria-expanded={open}>
          {open ? <ChevronDown size={13} className="tc-caret" /> : <ChevronRight size={13} className="tc-caret" />}
          <span className="tc-sec-title">{title}</span>
          {/* One number only, and only when it says something: unread count. */}
          {unread ? (
            <span className="tc-sec-count" title={t().sidebar.unreadCount(unread)}>
              {unread}
            </span>
          ) : null}
        </button>
      ) : null}
      {body}
      {open && capped && (all || hidden > 0) ? (
        <button className="tc-more" onClick={() => setAll((a) => !a)}>
          {all ? t().sidebar.showLess : t().sidebar.showOlder(hidden)}
        </button>
      ) : null}
    </div>
  );
}
