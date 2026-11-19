import { useState, type JSX, type CSSProperties } from "react";
import { hue, initials } from "../lib/format";
import { STATUS_COLOR, type Status } from "../lib/presence";

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
// around the image via a wrapper; "Unknown" draws no ring.
export function Avatar({ name, uri, small, mri, status, onOpen }: AvatarProps): JSX.Element {
  const [broken, setBroken] = useState(false);
  const style = { background: `hsl(${hue(name)} 45% 52%)` };
  const clickable = !!(mri && onOpen);
  const av = (
    <div
      className={"tc-av" + (small ? " sm" : "") + (clickable ? " tc-av-btn" : "")}
      style={style}
      onClick={clickable ? (e) => { e.stopPropagation(); onOpen!(mri!); } : undefined}
      title={clickable ? "View " + (name || "profile") : undefined}
    >
      {uri && !broken ? <img src={uri} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </div>
  );
  const ring = status && status !== "Unknown";
  if (!ring) return av;
  return (
    <div className={"tc-av-ring is-" + status!.toLowerCase() + (small ? " sm" : "")} style={{ "--tc-ring": STATUS_COLOR[status!] } as CSSProperties} title={status}>
      {av}
    </div>
  );
}
