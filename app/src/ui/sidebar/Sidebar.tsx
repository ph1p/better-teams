import type { JSX, MouseEvent, RefObject } from "react";
import { SideResize } from "./SideResize";
import { Bell, CheckCheck, Search, SquarePen, X } from "lucide-react";
import { Section } from "./Section";
import { Row } from "./Row";
import { MeBar } from "./MeBar";
import type { SideSection } from "./sections";
import type { Activity, Chat } from "../../types";
import { ActivityList } from "../activity/ActivityList";
import { t } from "../../i18n";

interface SidebarProps {
  sections: SideSection[];
  /** Notes self-chat for the bottom slot (normal view only). */
  selfSlot?: Chat;
  /** Inbox tab shown while the bell is on: unread chats or the activity feed. */
  inboxTab: InboxTab;
  onInboxTab: (tab: InboxTab) => void;
  /** Bell button: turns the inbox (unread chats + activity) on and off. */
  onBell: () => void;
  activity: { items: Activity[]; unread: number; chats: Chat[]; onOpen: (a: Activity) => void };
  sel: string | null;
  error: string;
  compact: boolean;
  onCompact: (compact: boolean) => void;
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
  onTeamChannels: (e: MouseEvent<HTMLElement>, chat: Chat) => void;
  onHide?: () => void;
  onError: (msg: string) => void;
}

export type InboxTab = "unread" | "activity";

// Left column: header buttons, search + Unread filter, chat sections, the Notes
// slot and the "me" bar.
export function Sidebar(p: SidebarProps): JSX.Element {
  const {
    sections,
    selfSlot,
    inboxTab,
    onInboxTab,
    onBell,
    activity,
    sel,
    error,
    compact,
    query,
    unreadOnly,
    unreadCount,
    searchRef,
    onCompact,
    onNewChat,
    onQuery,
    onSearchEnter,
    onUnreadFilter,
    onPick,
    onOpenProfile,
    onMenu,
    onAddChannel,
    onTeamChannels,
    onHide,
    onError,
  } = p;
  const s = t().sidebar;
  const showActivity = unreadOnly && inboxTab === "activity";
  return (
    <aside className="tc-side">
      <div className="tc-side-head">
        <div className="tc-side-spacer" />
        <button
          className={"tc-side-btn tc-bell" + (unreadOnly ? " on" : "")}
          onClick={onBell}
          aria-pressed={unreadOnly}
          title={unreadOnly ? s.allChatsTitle : s.unreadFilterTitle}
          aria-label={s.unread}
        >
          <Bell size={16} />
          {!unreadOnly && unreadCount + activity.unread ? (
            <span className="tc-unread-n">{unreadCount + activity.unread}</span>
          ) : null}
        </button>
        <button className="tc-side-btn" onClick={onNewChat} title={s.newChat} aria-label={s.newChat}>
          <SquarePen size={16} />
        </button>
      </div>
      {unreadOnly ? (
        <div className="tc-side-tools tc-inbox-tabs" role="tablist">
          {(["unread", "activity"] as const).map((tab) => {
            const n = tab === "unread" ? unreadCount : activity.unread;
            return (
              <button
                key={tab}
                role="tab"
                aria-selected={inboxTab === tab}
                className={"tc-inbox-tab" + (inboxTab === tab ? " on" : "")}
                onClick={() => onInboxTab(tab)}
              >
                {tab === "unread" ? s.unread : s.activity}
                {n ? <span className="tc-unread-n">{n}</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
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
            {query ? (
              <button
                className="tc-search-clear"
                onClick={() => {
                  onQuery("");
                  searchRef.current?.focus();
                }}
                title={s.clearSearch}
                aria-label={s.clearSearch}
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>
      )}
      <div className="tc-list">
        {error ? (
          <div className="tc-note">
            {s.cantRead}
            <br />
            <small>{error}</small>
          </div>
        ) : null}
        {showActivity ? (
          <ActivityList
            items={activity.items}
            chats={activity.chats}
            onOpen={activity.onOpen}
            onOpenProfile={onOpenProfile}
          />
        ) : null}
        {(showActivity ? [] : sections).map((sec) => (
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
            onTeamChannels={onTeamChannels}
          />
        ))}
        {!error && !sections.length && !showActivity ? (
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
      <MeBar compact={compact} onCompact={onCompact} onSwitchToTeams={onHide} onError={onError} />
      <SideResize />
    </aside>
  );
}
