import { useEffect, useRef, useState, type JSX, type CSSProperties } from "react";
import { ArrowLeftRight, Check, RotateCcw, ChevronUp } from "lucide-react";
import { myMri, profile } from "../../teamsData";
import { setMyStatus, type SettableStatus } from "../../status";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { STATUS_COLOR, setSelfPresence, usePresence, type Status } from "../lib/presence";

const LABEL: Record<Status, string> = {
  Available: "Available",
  Busy: "Busy",
  DoNotDisturb: "Do not disturb",
  BeRightBack: "Be right back",
  Away: "Away",
  Offline: "Offline",
  Unknown: "Status unknown",
};

const CHOICES: Array<[Exclude<SettableStatus, "Reset">, string]> = [
  ["Available", "Available"],
  ["Busy", "Busy"],
  ["DoNotDisturb", "Do not disturb"],
  ["BeRightBack", "Be right back"],
  ["Away", "Appear away"],
  ["Offline", "Appear offline"],
];

interface MeBarProps {
  onSwitchToTeams?: () => void;
  onError?: (msg: string) => void;
}

// Sidebar footer: the signed-in user with their presence, plus a menu to change
// status (driven through Teams' own profile menu) and to switch to the native
// Teams UI underneath.
export function MeBar({ onSwitchToTeams, onError }: MeBarProps): JSX.Element {
  const { statusOf, self } = usePresence();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const mri = myMri();
  const p = mri ? profile(mri) : null;
  const name = (p && p.displayName) || "You";
  const s = self();
  const status: Status = s !== "Unknown" ? s : statusOf(mri);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", close, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  const choose = async (st: SettableStatus): Promise<void> => {
    setOpen(false);
    const prev = status;
    if (st !== "Reset") setSelfPresence(st);
    const r = await setMyStatus(st);
    if (!r.ok) {
      setSelfPresence(prev);
      onError?.("Couldn't change status: " + r.reason);
    }
  };

  return (
    <div className="tc-me" ref={box}>
      {open ? (
        <div className="tc-me-menu" role="menu">
          <div className="tc-me-menu-sec">Status</div>
          {CHOICES.map(([st, label]) => (
            <button key={st} className="tc-menu-item" role="menuitemradio" aria-checked={status === st} onClick={() => choose(st)}>
              <span className={"tc-me-dot is-" + st.toLowerCase()} style={{ "--tc-ring": STATUS_COLOR[st] } as CSSProperties} />
              <span className="tc-me-menu-label">{label}</span>
              {status === st ? <Check size={14} /> : null}
            </button>
          ))}
          <button className="tc-menu-item" onClick={() => choose("Reset")}>
            <RotateCcw size={14} />
            <span className="tc-me-menu-label">Reset status</span>
          </button>
          <div className="tc-me-menu-sep" />
          <button className="tc-menu-item" onClick={() => { setOpen(false); onSwitchToTeams?.(); }}>
            <ArrowLeftRight size={14} />
            <span className="tc-me-menu-label">Switch to Teams</span>
            <span className="tc-me-kb">⌥⌘T</span>
          </button>
        </div>
      ) : null}
      <button
        className={"tc-me-btn" + (open ? " on" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Status and view"
      >
        <Avatar name={name} uri={mri ? avatarUri(mri) : undefined} status={status} />
        <span className="tc-me-text">
          <span className="tc-me-name">{name}</span>
          <span className="tc-me-status">{LABEL[status]}</span>
        </span>
        <ChevronUp size={15} className="tc-me-chev" />
      </button>
    </div>
  );
}
