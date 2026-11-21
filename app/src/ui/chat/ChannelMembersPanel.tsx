// A channel's members, under the chat header. A standard channel (General
// too) shows its team's roster, a private one its own (getChannelActions
// decides). Adding people and removing them show only where Teams lets us:
// team owners for a team, the private channel's owners for removal. Owners
// list first, with a badge, as do guests.

import { t } from "../../i18n";
import { useEffect, useState, type JSX } from "react";
import { UserPlus, X } from "lucide-react";
import {
  addChannelMembers,
  getChannelActions,
  listChannelMembers,
  myMri,
  removeChannelMember,
  type ChannelActions,
  type ChannelMember,
  type PeopleHit,
} from "../../teamsData";
import { useDismiss } from "../lib/dismiss";
import { useArm } from "../lib/arm";
import type { Flash } from "../lib/toast";
import type { Chat } from "../../types";
import { PeoplePicker, Person, addLabel } from "./MembersPanel";

interface ChannelMembersPanelProps {
  chat: Chat;
  known: () => PeopleHit[];
  flash: Flash;
  onClose: () => void;
  onOpenProfile: (mri: string) => void;
}

const isOwner = (m: ChannelMember): boolean => m.role.toLowerCase() === "admin";
const isGuest = (m: ChannelMember): boolean => m.role.toLowerCase() === "guest" || m.mri.includes("#EXT#");
const byRole = (a: ChannelMember, b: ChannelMember): number =>
  Number(isOwner(b)) - Number(isOwner(a)) || a.displayName.localeCompare(b.displayName);

export function ChannelMembersPanel({
  chat,
  known,
  flash,
  onClose,
  onOpenProfile,
}: ChannelMembersPanelProps): JSX.Element {
  // undefined while Teams is asked; null when it didn't answer.
  const [acts, setActs] = useState<ChannelActions | null | undefined>(undefined);
  const [members, setMembers] = useState<ChannelMember[] | null | undefined>(undefined);
  const [picked, setPicked] = useState<PeopleHit[]>([]);
  const [busy, setBusy] = useState(false);
  const { armed, tryArm } = useArm<string>();
  const me = myMri();
  useDismiss(true, "#tc-root .tc-members, #tc-root .tc-opts-menu", onClose);

  useEffect(() => {
    let live = true;
    void (async () => {
      const a = await getChannelActions(chat.id);
      if (!live) return;
      setActs(a);
      const ms = a ? await listChannelMembers(a) : null;
      if (live) setMembers(ms && [...ms].sort(byRole));
    })();
    return () => {
      live = false;
    };
  }, [chat.id]);

  const has = (mri: string): boolean => !!members?.some((m) => m.mri === mri);

  // Optimistic: the roster shows the change at once, and takes it back on failure.
  const add = async (): Promise<void> => {
    if (!acts) return;
    const people = picked.filter((p) => !has(p.mri));
    setBusy(true);
    const before = members;
    setMembers(
      (ms) =>
        ms &&
        [
          ...ms,
          ...people.map((p): ChannelMember => ({
            mri: p.mri,
            displayName: p.displayName,
            jobTitle: p.jobTitle,
            role: "User",
            objectId: "",
            tenantId: "",
          })),
        ].sort(byRole),
    );
    const r = await addChannelMembers(
      acts,
      people.map((p) => p.mri),
    );
    setBusy(false);
    if (r.ok) {
      setPicked([]);
      flash(t().app.membersAdded(people.length), 3000);
    } else {
      setMembers(before);
      flash(t().app.addFailed(r.reason), 5000);
    }
  };
  const remove = (m: ChannelMember): void =>
    tryArm(
      m.mri,
      () =>
        void (async () => {
          if (!acts) return;
          const before = members;
          setMembers((ms) => ms && ms.filter((x) => x.mri !== m.mri));
          const r = await removeChannelMember(acts, m);
          if (r.ok) flash(t().app.memberRemoved(m.displayName), 3000);
          else {
            setMembers(before);
            flash(t().app.removeFailed(r.reason), 5000);
          }
        })(),
    );

  const team = acts?.members === "team";
  const c = t().chat;
  return (
    <div className="tc-members" role="dialog" aria-label={c.membersOf(chat.title)}>
      <header className="tc-members-head">
        <strong>{c.channelMembers}</strong>
        <span className="tc-members-n">{members ? members.length : ""}</span>
        <button className="tc-ghost tc-icon-only" onClick={onClose} aria-label={c.closeMembers}>
          <X size={15} />
        </button>
      </header>
      {team ? <div className="tc-members-note">{c.teamRosterNote(chat.team)}</div> : null}

      {acts?.addMembers && members ? (
        <div className="tc-members-add">
          <PeoplePicker known={known} exclude={has} picked={picked} setPicked={setPicked} autoFocus />
          {picked.length ? (
            <div className="tc-members-go end">
              <button className="tc-newchat-go" disabled={busy} onClick={() => void add()}>
                <UserPlus size={14} /> {addLabel(picked)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {members === undefined ? (
        <div className="tc-members-note">{c.membersLoading}</div>
      ) : !members ? (
        <div className="tc-members-note">{c.membersUnavailable}</div>
      ) : (
        <ul className="tc-members-list">
          {members.map((m) => (
            <Person
              key={m.mri}
              mri={m.mri}
              name={m.displayName}
              sub={m.jobTitle}
              you={m.mri === me}
              badge={isOwner(m) ? c.owner : isGuest(m) ? c.guest : undefined}
              armed={armed === m.mri}
              removeTitle={team ? c.removeFromTeam : c.removeFromChannel}
              onOpen={onOpenProfile}
              onRemove={acts?.removeMembers && m.mri !== me ? () => remove(m) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
