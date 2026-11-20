import { useState, type JSX, type CSSProperties } from "react";
import { avatarUri, hue, initials } from "../lib/format";
import { profile } from "../../teamsData";
import { STATUS_COLOR, statusLabel, type Status } from "../lib/presence";
import { isAppMri } from "../../apps";
import { t } from "../../i18n";

interface AvatarProps {
  name: string;
  uri?: string;
  small?: boolean;
  mri?: string;
  status?: Status;
  onOpen?: (mri: string) => void;
  className?: string;
}

// A circular avatar: the cached/live photo, or coloured initials on error or
// when no photo exists. Clickable (opens the profile) only when an MRI + handler
// are both given. When a presence `status` is known, a coloured ring is drawn
// around the image via a wrapper; "Unknown" draws no ring. Teams apps (28: MRIs)
// get a rounded-square icon instead: no profile to open, no presence.
export function Avatar({ name, uri, small, mri, status, onOpen, className }: AvatarProps): JSX.Element {
  const [broken, setBroken] = useState(false);
  const style = { background: `hsl(${hue(name)} 45% 52%)` };
  const app = !!mri && isAppMri(mri);
  const clickable = !!(mri && onOpen) && !app;
  const av = (
    <div
      className={"tc-av" + (small ? " sm" : "") + (app ? " app" : "") + (clickable ? " tc-av-btn" : "") + (className ? " " + className : "")}
      style={style}
      onClick={clickable ? (e) => { e.stopPropagation(); onOpen!(mri!); } : undefined}
      title={clickable ? t().app.viewProfile(name || t().app.profile) : undefined}
    >
      {uri && !broken ? <img src={uri} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </div>
  );
  const ring = !app && status && status !== "Unknown";
  if (!ring) return av;
  return (
    <div className={"tc-av-ring is-" + status!.toLowerCase() + (small ? " sm" : "")} style={{ "--tc-ring": STATUS_COLOR[status!] } as CSSProperties} title={statusLabel(status!)}>
      {av}
    </div>
  );
}

/** Face for one group member: photo or tinted initials, no ring, not clickable. */
function Face({ mri, className }: { mri: string; className: string }): JSX.Element {
  return <Avatar name={profile(mri).displayName || ""} uri={avatarUri(mri)} className={className} />;
}

// A group chat's avatar: two members stacked diagonally in the footprint of
// one avatar. The member count is in the header ("5 people") and the names
// are in the title, so the faces alone carry the "group" look.
export function GroupAvatar({ members, small }: { members: string[]; small?: boolean }): JSX.Element {
  return (
    <div className={"tc-av-group" + (small ? " sm" : "")} aria-hidden="true">
      <Face mri={members[1]} className="back" />
      <Face mri={members[0]} className="front" />
    </div>
  );
}
