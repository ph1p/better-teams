import { useMemo, type JSX } from "react";
import { Hash, House } from "lucide-react";
import { getTeamChannels, type TeamChannel } from "../../teamsData";
import { useDismiss } from "../lib/dismiss";
import { useLoad } from "../lib/load";
import { menuPos } from "../lib/menuPos";
import { t } from "../../i18n";
import type { Chat } from "../../types";

export interface TeamMenu {
  /** The label button: the menu opens below it, or above in the lower half. */
  rect: DOMRect;
  /** Any channel row of the team; gives its teamId and name. */
  chat: Chat;
}

interface TeamChannelsMenuProps {
  menu: TeamMenu;
  /** Every conversation; the team's channels from it show until Teams answers. */
  chats: Chat[];
  /** Show or hide one channel; resolves false when Teams refused it. */
  onSetShown: (channelId: string, shown: boolean) => Promise<boolean>;
  onClose: () => void;
}

// General first, then the recommended ones, then by name — Teams' own order.
const order = (a: TeamChannel, b: TeamChannel): number =>
  Number(b.general) - Number(a.general) ||
  Number(b.recommended) - Number(a.recommended) ||
  a.name.localeCompare(b.name);

const loadChannels = (teamId: string): Promise<TeamChannel[] | null> =>
  teamId ? getTeamChannels(teamId) : Promise.resolve(null);

// The team label's channel menu: every channel of the team with a checkbox to
// show or hide it in the sidebar, as Teams' "Show/hide channels". General has
// the house icon; channels the team owner shows by default say "Recommended".
// Our own list (from IndexedDB) shows at once; Teams' team query then adds
// channels we have no row for and the Recommended flags.
export function TeamChannelsMenu({ menu, chats, onSetShown, onClose }: TeamChannelsMenuProps): JSX.Element {
  // The label's own button toggles the menu, so a press on it doesn't dismiss.
  useDismiss(true, "#tc-root .tc-team-menu, #tc-root .tc-team-chans", onClose);
  const teamId = menu.chat.teamId || "";
  // undefined while loading, null when Teams didn't answer.
  const [remote, setRemote] = useLoad(teamId, loadChannels);

  // A channel with a sidebar row takes its state from that row, which
  // onSetShown patches optimistically; the rest from Teams' list.
  const list = useMemo(() => {
    const rows = new Map(chats.filter((c) => c.isChannel && !c.left && c.teamId === teamId).map((c) => [c.id, c]));
    const base =
      remote ??
      [...rows.values()].map((c) => ({
        id: c.id,
        name: c.title,
        general: !!c.general,
        recommended: false,
        shown: true,
      }));
    return base
      .map((c) => {
        const row = rows.get(c.id);
        return row ? { ...c, shown: !row.channelHidden } : c;
      })
      .sort(order);
  }, [chats, teamId, remote]);

  const toggle = async (c: TeamChannel): Promise<void> => {
    const shown = !c.shown;
    const patch = (v: boolean): void => setRemote((r) => r && r.map((x) => (x.id === c.id ? { ...x, shown: v } : x)));
    patch(shown);
    if (!(await onSetShown(c.id, shown))) patch(!shown);
  };

  const s = t().sidebar;
  const team = menu.chat.team || s.otherTeam;
  return (
    <div
      className="tc-menu tc-team-menu"
      role="dialog"
      aria-label={s.teamChannelsOf(team)}
      style={menuPos(menu.rect.left, menu.rect.top, menu.rect.bottom, 280, 4)}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="tc-team-menu-head">{s.teamChannelsOf(team)}</div>
      <div className="tc-team-menu-list">
        {list.map((c) => (
          <label key={c.id} className={"tc-menu-item tc-team-chan" + (c.shown ? "" : " off")}>
            <input type="checkbox" checked={c.shown} onChange={() => void toggle(c)} />
            {c.general ? <House size={14} /> : <Hash size={14} />}
            <span className="tc-team-chan-name">{c.name}</span>
            {c.recommended ? <span className="tc-team-chan-rec">{s.recommended}</span> : null}
          </label>
        ))}
      </div>
      <div className="tc-team-menu-hint">{s.teamChannelsHint}</div>
    </div>
  );
}
