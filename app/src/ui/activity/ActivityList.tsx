import { useState } from "react";
import { AtSign, Bell, Reply, SmilePlus } from "lucide-react";
import { profile } from "../../teamsData";
import { Avatar } from "../shared/Avatar";
import { avatarUri, chatTitle, fmtFull, fmtTime } from "../lib/format";
import { glyphFor } from "../lib/reactions";
import { t } from "../../i18n";
import type { Activity, Chat } from "../../types";

interface ActivityListProps {
  items: Activity[];
  chats: Chat[];
  onOpen: (a: Activity) => void;
  onOpenProfile: (mri: string) => void;
}

const KIND_ICON = { mention: AtSign, reaction: SmilePlus, reply: Reply, other: Bell } as const;

function label(a: Activity) {
  const s = t().sidebar;
  switch (a.kind) {
    case "mention":
      return s.activityMention;
    case "reply":
      return s.activityReply;
    case "reaction":
      return s.activityReaction(glyphFor(a.subtype) || a.subtype, a.count);
    default:
      return s.activityOther(a.type);
  }
}

export function ActivityList({ items, chats, onOpen, onOpenProfile }: ActivityListProps) {
  const s = t().sidebar;
  // The feed is marked read as soon as it shows, so remember what was new on
  // arrival and keep highlighting it while the list stays open.
  const [fresh] = useState(() => new Set(items.filter((a) => a.unread).map((a) => a.id)));
  const byId = new Map(chats.map((c) => [c.id, c]));
  if (!items.length) return <div className="tc-list-empty">{s.activityEmpty}</div>;
  return (
    <div className="tc-activity">
      {items.map((a) => {
        const chat = byId.get(a.threadId);
        const name = profile(a.actorMri).displayName || a.actorName;
        const Icon = KIND_ICON[a.kind];
        const unread = a.unread || fresh.has(a.id);
        return (
          <button
            key={a.id}
            className={"tc-act" + (unread ? " unread" : "")}
            disabled={!chat}
            onClick={() => onOpen(a)}
          >
            <span className="tc-act-av">
              <Avatar name={name || "?"} uri={avatarUri(a.actorMri)} mri={a.actorMri} onOpen={onOpenProfile} />
              <span className={"tc-act-kind " + a.kind}>
                <Icon size={10} strokeWidth={2.5} />
              </span>
            </span>
            <span className="tc-act-body">
              <span className="tc-act-top">
                <span className="tc-act-line">
                  <b>{name}</b> {label(a)}
                </span>
                <span className="tc-time" title={fmtFull(a.time)}>
                  {fmtTime(a.time)}
                </span>
              </span>
              {a.preview ? <span className="tc-act-prev">{a.preview}</span> : null}
              <span className="tc-act-where">{s.activityIn(chat ? chatTitle(chat) : s.activitySomeChat)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
