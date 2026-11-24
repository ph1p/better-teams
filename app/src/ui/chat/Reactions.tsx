import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import { myMri, profile } from "../../teamsData";
import { personName } from "../../names";
import { t } from "../../i18n";
import type { Reaction } from "../../types";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { glyphFor } from "../lib/reactions";
import { menuPos } from "../lib/menuPos";

const OPEN_MS = 250;
const CLOSE_MS = 150;
const POP_W = 240;

interface Props {
  reactions: readonly Reaction[];
  onReact: (key: string, add: boolean) => void;
  onOpenProfile: (mri: string) => void;
}

// The reaction pills under a message. Hovering one shows who reacted (avatar +
// name, me first); each person opens their profile. The popover is portaled to
// #tc-root with a fixed position so the message list's scroll box can't clip it,
// and it stays open while the pointer moves from the pill into it.
export function Reactions({ reactions, onReact, onOpenProfile }: Props): JSX.Element {
  const [hover, setHover] = useState<{ key: string; style: CSSProperties } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const later = (ms: number, fn: () => void): void => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  };
  const show = (key: string, el: HTMLElement, now = false): void => {
    const open = (): void => {
      const r = el.getBoundingClientRect();
      setHover({ key, style: menuPos(r.left, r.top, r.bottom, POP_W, 6) });
    };
    if (now) {
      clearTimeout(timer.current);
      open();
    } else later(hover ? 0 : OPEN_MS, open);
  };
  const hide = (): void => later(CLOSE_MS, () => setHover(null));
  const keep = (): void => clearTimeout(timer.current);

  const cur = hover ? reactions.find((r) => r.key === hover.key) : undefined;
  const root = cur && document.getElementById("tc-root");
  return (
    <div className="tc-reacts">
      {reactions.map((r) => (
        <button
          key={r.key}
          className={"tc-react" + (r.mine ? " mine" : "")}
          aria-label={r.mine ? t().chat.removeReaction(r.key) : t().chat.react(r.key)}
          onClick={() => onReact(r.key, !r.mine)}
          onMouseEnter={(e) => show(r.key, e.currentTarget)}
          onMouseLeave={hide}
          onFocus={(e) => show(r.key, e.currentTarget, true)}
          onBlur={hide}
        >
          {glyphFor(r.key)} {r.count}
        </button>
      ))}
      {hover && cur && root
        ? createPortal(
            <ReactorList r={cur} style={hover.style} onEnter={keep} onLeave={hide} onOpenProfile={onOpenProfile} />,
            root,
          )
        : null}
    </div>
  );
}

interface ListProps {
  r: Reaction;
  style: CSSProperties;
  onEnter: () => void;
  onLeave: () => void;
  onOpenProfile: (mri: string) => void;
}

function ReactorList({ r, style, onEnter, onLeave, onOpenProfile }: ListProps): JSX.Element {
  const me = myMri();
  // Me first, then everyone else in reaction order.
  const users = [...(r.users ?? [])].sort((a, b) => Number(b === me) - Number(a === me));
  const unknown = Math.max(0, r.count - users.length);
  return (
    <div
      className="tc-reactors"
      style={{ ...style, width: POP_W }}
      role="dialog"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="tc-reactors-head">
        <span className="tc-reactors-glyph">{glyphFor(r.key)}</span>
        <span>{t().chat.reactedCount(r.count)}</span>
      </div>
      {users.map((mri) => {
        const mine = mri === me;
        const name = mine ? t().common.you : personName(profile(mri), "", mri) || t().common.unknown;
        return (
          <button key={mri} className="tc-reactor" onClick={() => onOpenProfile(mri)}>
            <Avatar name={name} uri={avatarUri(mri)} mri={mri} small />
            <span className="tc-reactor-name">{name}</span>
          </button>
        );
      })}
      {unknown ? <div className="tc-reactors-more">{t().chat.reactedOthers(unknown)}</div> : null}
    </div>
  );
}
