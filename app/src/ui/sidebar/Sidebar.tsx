import type { JSX, MouseEvent, RefObject } from "react";
import { CheckCheck, Rows2, Rows3, Search, SquarePen } from "lucide-react";
import { Section } from "./Section";
import { Row } from "./Row";
import { MeBar } from "./MeBar";
import type { SideSection } from "./sections";
import type { Chat } from "../../types";

interface SidebarProps {
  sections: SideSection[];
  /** Notes self-chat for the bottom slot (normal view only). */
  selfSlot?: Chat;
  sel: string | null;
  error: string;
  compact: boolean;
  onToggleCompact: () => void;
  onNewChat: () => void;
  query: string;
  onQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Enter in search: open the top hit. */
  onSearchEnter: () => void;
  unreadOnly: boolean;
  unreadCount: number;
  onUnreadFilter: (on: boolean) => void;
  onPick: (id: string) => void;
  onOpenProfile: (mri: string) => void;
  onMenu: (e: MouseEvent, chat: Chat) => void;
  onHide?: () => void;
  onError: (msg: string) => void;
}

// Left column: header buttons, search + Unread filter, chat sections, the Notes
// slot and the "me" bar.
export function Sidebar(p: SidebarProps): JSX.Element {
  const { sections, selfSlot, sel, error, compact, query, unreadOnly, unreadCount } = p;
  return (
    <aside className="tc-side">
      <div className="tc-side-head">
        <div className="tc-side-spacer" />
        <button className="tc-side-btn" onClick={p.onToggleCompact}
          title={compact ? "Show message previews" : "Compact list"} aria-label={compact ? "Show message previews" : "Compact list"}>
          {compact ? <Rows2 size={16} /> : <Rows3 size={16} />}
        </button>
        <button className="tc-side-btn" onClick={p.onNewChat} title="New chat" aria-label="New chat">
          <SquarePen size={16} />
        </button>
      </div>
      <div className="tc-side-tools">
        <div className="tc-search">
          <Search size={15} className="tc-search-icon" />
          <input
            ref={p.searchRef}
            placeholder="Search  ⌘K"
            value={query}
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                p.onQuery("");
                e.currentTarget.blur();
              } else if (e.key === "Enter") {
                p.onSearchEnter();
              }
            }}
          />
        </div>
        <button
          className={"tc-unread-pill" + (unreadOnly ? " on" : "")}
          aria-pressed={unreadOnly}
          onClick={() => p.onUnreadFilter(!unreadOnly)}
          title="Only unread conversations  ⌥U · next unread ⌥⇧↓"
        >
          Unread{unreadCount ? <span className="tc-unread-n">{unreadCount}</span> : null}
        </button>
      </div>
      <div className="tc-list">
        {error ? (
          <div className="tc-note">
            Can't read Teams' local data in this window.
            <br />
            <small>{error}</small>
          </div>
        ) : null}
        {sections.map((s) => (
          <Section key={s.id} id={s.id} title={s.title} rows={s.rows} sel={sel} compact={compact}
            capped={s.capped} groupByTeam={s.groupByTeam} defaultCollapsed={s.defaultCollapsed}
            onPick={p.onPick} onOpenProfile={p.onOpenProfile} onMenu={p.onMenu} />
        ))}
        {!error && !sections.length ? (
          <div className="tc-list-empty">
            {query ? <>No chats match “{query}”.</> : unreadOnly ? (
              <div className="tc-caught-up">
                <CheckCheck size={28} className="tc-caught-up-icon" />
                <strong>All caught up</strong>
                <span>No unread conversations.</span>
                <button className="tc-more" onClick={() => p.onUnreadFilter(false)}>Show all conversations</button>
              </div>
            ) : "No conversations yet."}
          </div>
        ) : null}
      </div>
      {selfSlot ? (
        <div className="tc-self-slot">
          <Row chat={selfSlot} compact selected={selfSlot.id === sel} onClick={() => p.onPick(selfSlot.id)}
            onOpenProfile={p.onOpenProfile} onMenu={p.onMenu} />
        </div>
      ) : null}
      <MeBar onSwitchToTeams={p.onHide} onError={p.onError} />
    </aside>
  );
}
