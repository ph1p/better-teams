import { useState, type JSX, type CSSProperties } from "react";
import { hue, initials } from "../lib/format";
import { STATUS_COLOR, type Status } from "../lib/presence";
import { isAppMri } from "../../apps";

interface AvatarProps {
  name: string;
  uri?: string;
  small?: boolean;
  mri?: string;
  status?: Status;
  onOpen?: (mri: string) => void;
}

// A circular avatar: the cached/live photo, or coloured initials on error or
// when no photo exists. Clickable (opens the profile) only when an MRI + handler
// are both given. When a presence `status` is known, a coloured ring is drawn
// around the image via a wrapper; "Unknown" draws no ring. Teams apps (28: MRIs)
// get a rounded-square icon instead: no profile to open, no presence.
export function Avatar({ name, uri, small, mri, status, onOpen }: AvatarProps): JSX.Element {
  const [broken, setBroken] = useState(false);
  const style = { background: `hsl(${hue(name)} 45% 52%)` };
  const app = !!mri && isAppMri(mri);
  const clickable = !!(mri && onOpen) && !app;
  const av = (
    <div
      className={"tc-av" + (small ? " sm" : "") + (app ? " app" : "") + (clickable ? " tc-av-btn" : "")}
      style={style}
      onClick={clickable ? (e) => { e.stopPropagation(); onOpen!(mri!); } : undefined}
      title={clickable ? "View " + (name || "profile") : undefined}
    >
      {uri && !broken ? <img src={uri} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </div>
  );
  const ring = !app && status && status !== "Unknown";
  if (!ring) return av;
  return (
    <div className={"tc-av-ring is-" + status!.toLowerCase() + (small ? " sm" : "")} style={{ "--tc-ring": STATUS_COLOR[status!] } as CSSProperties} title={status}>
      {av}
    </div>
  );
}
