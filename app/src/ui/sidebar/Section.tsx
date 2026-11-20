import { useState, type JSX, type MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Row } from "./Row";
import { RECENT_MS, SECTION_CAP, SECTION_MIN } from "../lib/constants";
import { usePref } from "../lib/prefs";
import type { Chat } from "../../types";
import { t } from "../../i18n";

interface SectionProps {
  // Stable key for the persisted collapsed state ("dms", "channels", ...).
  id: string;
  title: string;
  rows: Chat[];
  sel: string | null;
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
}

// A collapsible sidebar group; an empty title renders the rows alone, without a
// header. A section shows what is current, not everything: at least
// SECTION_MIN rows, then those active within RECENT_MS (up to SECTION_CAP);
// older ones sit behind "Show N older". Unread rows and the open chat always
// show — even in a collapsed section, so collapsing never hides new messages.
export function Section({
  id, title, rows, sel, compact, capped = true, defaultCollapsed = false, groupByTeam = false,
  onPick, onOpenProfile, onMenu,
}: SectionProps): JSX.Element {
  const [collapsed, setCollapsed] = usePref<boolean>("sec:" + id, defaultCollapsed);
  const [all, setAll] = useState(false);
  const unread = rows.filter((r) => r.unread).length;
  const open = !collapsed || !title;
  const cutoff = Date.now() - RECENT_MS;
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
      body.push(<div key={"t:" + c.team} className="tc-team-label">{c.team || t().sidebar.otherTeam}</div>);
    }
    body.push(
      <Row key={c.id} chat={c} compact={compact} showTeam={!groupByTeam} selected={c.id === sel}
        onClick={() => onPick(c.id)} onOpenProfile={onOpenProfile} onMenu={onMenu} />
    );
  }

  return (
    <div className={"tc-section" + (open ? "" : " collapsed")}>
      {title ? (
        <button className="tc-sec" onClick={() => setCollapsed((c) => !c)} aria-expanded={open}>
          {open ? <ChevronDown size={13} className="tc-caret" /> : <ChevronRight size={13} className="tc-caret" />}
          <span className="tc-sec-title">{title}</span>
          {/* One number only, and only when it says something: unread count. */}
          {unread ? <span className="tc-sec-count" title={t().sidebar.unreadCount(unread)}>{unread}</span> : null}
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
