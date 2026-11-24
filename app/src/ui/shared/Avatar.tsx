import { useState, type JSX, type CSSProperties } from "react";
import { CalendarDays, Hash, Lock, NotebookPen, Share2 } from "lucide-react";
import { avatarUri, hue, initials } from "../lib/format";
import { profile } from "../../teamsData";
import { STATUS_COLOR, statusLabel, statusOf, type Status } from "../lib/presence";
import { isAppMri } from "../../apps";
import { t } from "../../i18n";
import type { Chat } from "../../types";

interface AvatarProps {
  name: string;
  uri?: string;
  small?: boolean;
  mri?: string;
  status?: Status;
  onOpen?: (mri: string) => void;
  className?: string;
  style?: CSSProperties;
}

// A circular avatar: the cached/live photo, or coloured initials on error or
// when no photo exists. Clickable (opens the profile) only when an MRI + handler
// are both given. When a presence `status` is known, a coloured ring is drawn
// around the image via a wrapper; "Unknown" draws no ring. Teams apps (28: MRIs)
// get a rounded-square icon instead: no profile to open, no presence.
export function Avatar({ name, uri, small, mri, status, onOpen, className, style: extra }: AvatarProps): JSX.Element {
  const [broken, setBroken] = useState(false);
  const style = { background: `hsl(${hue(name)} 45% 52%)`, ...extra };
  const app = !!mri && isAppMri(mri);
  const clickable = !!(mri && onOpen) && !app;
  const av = (
    <div
      className={
        "tc-av" +
        (small ? " sm" : "") +
        (app ? " app" : "") +
        (clickable ? " tc-av-btn" : "") +
        (className ? " " + className : "")
      }
      style={style}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onOpen!(mri!);
            }
          : undefined
      }
      title={clickable ? t().app.viewProfile(name || t().app.profile) : undefined}
    >
      {uri && !broken ? <img src={uri} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </div>
  );
  const ring = !app && status && status !== "Unknown";
  if (!ring) return av;
  return (
    <div
      className={"tc-av-ring is-" + status!.toLowerCase() + (small ? " sm" : "")}
      style={{ "--tc-ring": STATUS_COLOR[status!] } as CSSProperties}
      title={statusLabel(status!)}
    >
      {av}
    </div>
  );
}

/** Face for one group member: photo or tinted initials, not clickable. A known
 *  presence draws as a border inside the face (a box-shadow ring would be cut
 *  by the back face's mask); offline faces are greyed like single avatars. */
function Face({ mri, status, className }: { mri: string; status: Status; className: string }): JSX.Element {
  const ring = status !== "Unknown";
  return (
    <Avatar
      name={profile(mri).displayName || ""}
      uri={avatarUri(mri)}
      className={className + (ring ? " tc-face-ring is-" + status.toLowerCase() : "")}
      style={ring ? ({ "--tc-ring": STATUS_COLOR[status] } as CSSProperties) : undefined}
    />
  );
}

// A group chat's avatar: two members stacked diagonally in the footprint of
// one avatar, each with its presence. The member count is in the header
// ("5 people") and the names are in the title, so the faces alone carry the
// "group" look. Reads presence without subscribing: the parent's usePresence
// re-renders it.
export function GroupAvatar({ members, small }: { members: string[]; small?: boolean }): JSX.Element {
  return (
    <div className={"tc-av-group" + (small ? " sm" : "")} aria-hidden="true">
      <Face mri={members[1]} status={statusOf(members[1])} className="back" />
      <Face mri={members[0]} status={statusOf(members[0])} className="front" />
    </div>
  );
}

// A conversation's icon: a glyph box for channels, meetings and Notes, the
// two-face group avatar for group chats, else the other person's avatar with
// presence (clickable when `onOpen` is given). Presence is read, not
// subscribed: callers that need live rings call usePresence.
export function ChatIcon({
  chat,
  small,
  size,
  onOpen,
}: {
  chat: Chat;
  small?: boolean;
  /** Glyph size in the box. */
  size: number;
  onOpen?: (mri: string) => void;
}): JSX.Element {
  // Channels: a lock marks a private one, as in Teams; shared ones get their own glyph.
  const Glyph = chat.isChannel
    ? chat.channelType === "private"
      ? Lock
      : chat.channelType === "shared"
        ? Share2
        : Hash
    : chat.kind === "meeting"
      ? CalendarDays
      : chat.kind === "notes"
        ? NotebookPen
        : null;
  if (Glyph)
    return (
      <div
        className={"tc-av tc-hash" + (small ? " sm" : "")}
        title={chat.channelType ? t().common.channelType[chat.channelType] : undefined}
      >
        <Glyph size={size} />
      </div>
    );
  if (chat.group) return <GroupAvatar members={chat.members} small={small} />;
  return (
    <Avatar
      name={chat.title}
      uri={avatarUri(chat.avatarMri)}
      mri={chat.avatarMri}
      small={small}
      status={statusOf(chat.avatarMri)}
      onOpen={onOpen}
    />
  );
}
