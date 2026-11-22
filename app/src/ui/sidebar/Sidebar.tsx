import type { JSX, MouseEvent, RefObject } from "react";
import { CheckCheck, Rows2, Rows3, Search, SquarePen } from "lucide-react";
import { Section } from "./Section";
import { Row } from "./Row";
import { MeBar } from "./MeBar";
import type { SideSection } from "./sections";
import type { Chat } from "../../types";
import { t } from "../../i18n";

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
  onAddChannel: (chat: Chat) => void;
  onHide?: () => void;
  onError: (msg: string) => void;
}

// Left column: header buttons, search + Unread filter, chat sections, the Notes
// slot and the "me" bar.
export function Sidebar(p: SidebarProps): JSX.Element {
  const {
    sections,
    selfSlot,
    sel,
    error,
    compact,
    query,
    unreadOnly,
    unreadCount,
    searchRef,
    onToggleCompact,
    onNewChat,
    onQuery,
    onSearchEnter,
    onUnreadFilter,
    onPick,
    onOpenProfile,
    onMenu,
    onAddChannel,
    onHide,
    onError,
  } = p;
  const s = t().sidebar;
  return (
    <aside className="tc-side">
      <div className="tc-side-head">
        <div className="tc-side-spacer" />
        <button
          className="tc-side-btn"
          onClick={onToggleCompact}
          title={compact ? s.showPreviews : s.compactList}
          aria-label={compact ? s.showPreviews : s.compactList}
        >
          {compact ? <Rows2 size={16} /> : <Rows3 size={16} />}
        </button>
        <button className="tc-side-btn" onClick={onNewChat} title={s.newChat} aria-label={s.newChat}>
          <SquarePen size={16} />
        </button>
      </div>
      <div className="tc-side-tools">
        <div className="tc-search">
          <Search size={15} className="tc-search-icon" />
          <input
            ref={searchRef}
            placeholder={s.search}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onQuery("");
                e.currentTarget.blur();
              } else if (e.key === "Enter") {
                onSearchEnter();
              }
            }}
          />
        </div>
        <button
          className={"tc-unread-pill" + (unreadOnly ? " on" : "")}
          aria-pressed={unreadOnly}
          onClick={() => onUnreadFilter(!unreadOnly)}
          title={s.unreadFilterTitle}
        >
          {s.unread}
          {unreadCount ? <span className="tc-unread-n">{unreadCount}</span> : null}
        </button>
      </div>
      <div className="tc-list">
        {error ? (
          <div className="tc-note">
            {s.cantRead}
            <br />
            <small>{error}</small>
          </div>
        ) : null}
        {sections.map((sec) => (
          <Section
            key={sec.id}
            id={sec.id}
            title={sec.id === "search" || sec.id === "unread" ? "" : s.sections[sec.id]}
            rows={sec.rows}
            sel={sel}
            compact={compact}
            capped={sec.capped}
            groupByTeam={sec.groupByTeam}
            defaultCollapsed={sec.defaultCollapsed}
            onPick={onPick}
            onOpenProfile={onOpenProfile}
            onMenu={onMenu}
            onAddChannel={onAddChannel}
          />
        ))}
        {!error && !sections.length ? (
          <div className="tc-list-empty">
            {query ? (
              s.noMatch(query)
            ) : unreadOnly ? (
              <div className="tc-caught-up">
                <CheckCheck size={28} className="tc-caught-up-icon" />
                <strong>{s.caughtUp}</strong>
                <span>{s.noUnread}</span>
                <button className="tc-more" onClick={() => onUnreadFilter(false)}>
                  {s.showAll}
                </button>
              </div>
            ) : (
              s.noChats
            )}
          </div>
        ) : null}
      </div>
      {selfSlot ? (
        <div className="tc-self-slot">
          <Row
            chat={selfSlot}
            compact
            selected={selfSlot.id === sel}
            onClick={() => onPick(selfSlot.id)}
            onOpenProfile={onOpenProfile}
            onMenu={onMenu}
          />
        </div>
      ) : null}
      <MeBar onSwitchToTeams={onHide} onError={onError} />
    </aside>
  );
}
