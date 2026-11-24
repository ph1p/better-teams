import { t } from "../../i18n";
import { personName, useNameFormat } from "../../names";
import { useMemo, useRef, useState } from "react";
import { Trash2, UserPlus, X } from "lucide-react";
import { myMri, profile, type PeopleHit } from "../../teamsData";
import { Avatar } from "../shared/Avatar";
import { Select } from "../shared/Select";
import { avatarUri } from "../lib/format";
import { useDismiss } from "../lib/dismiss";
import { useArm } from "../lib/arm";
import { usePeopleSearch } from "../lib/peopleSearch";
import { scrollNear, usePickerKeys } from "../lib/pickerKeys";
import type { Chat } from "../../types";

/** Teams' "include chat history" choices, in its own day encoding. */
const HISTORY: { days: number; label: () => string }[] = [
  { days: -1, label: () => t().chat.historyNone },
  { days: 1, label: () => t().chat.historyDay },
  { days: 7, label: () => t().chat.historyWeek },
  { days: 0, label: () => t().chat.historyAll },
];

interface MembersPanelProps {
  chat: Chat;
  known: () => PeopleHit[];
  onClose: () => void;
  onOpenProfile: (mri: string) => void;
  onAdd: (chat: Chat, people: PeopleHit[], shareHistoryDays: number) => Promise<boolean>;
  onRemove: (chat: Chat, mri: string) => Promise<boolean>;
}

export function Person({
  mri,
  name,
  sub,
  badge,
  you,
  armed,
  removeTitle,
  onOpen,
  onRemove,
}: {
  mri: string;
  name?: string;
  sub?: string;
  badge?: string;
  you?: boolean;
  armed?: boolean;
  removeTitle?: string;
  onOpen: (mri: string) => void;
  onRemove?: () => void;
}) {
  useNameFormat();
  const p = profile(mri);
  const shown = personName(p, name || "", mri) || t().common.unknown;
  const job = p.jobTitle || sub;
  return (
    <li className="tc-member">
      <Avatar name={p.displayName || name || shown} uri={avatarUri(mri)} mri={mri} small onOpen={onOpen} />
      <span className="tc-member-text">
        <span className="tc-member-name">
          {shown}
          {you ? <span className="tc-member-you">{t().chat.youSuffix}</span> : null}
        </span>
        {job ? <span className="tc-member-sub">{job}</span> : null}
      </span>
      {badge ? <span className="tc-member-badge">{badge}</span> : null}
      {onRemove ? (
        <button
          className={"tc-x-btn tc-member-x" + (armed ? " armed" : "")}
          onClick={onRemove}
          title={armed ? t().chat.removeConfirm : removeTitle || t().chat.removeFromChat}
          aria-label={armed ? t().chat.removePersonConfirm(shown) : t().common.removeNamed(shown)}
        >
          {armed ? (
            <>
              <Trash2 size={13} /> {t().common.remove}
            </>
          ) : (
            <X size={14} />
          )}
        </button>
      ) : null}
    </li>
  );
}

export function PeoplePicker({
  known,
  exclude,
  picked,
  setPicked,
  autoFocus,
  team,
}: {
  known: () => PeopleHit[];
  exclude: (mri: string) => boolean;
  picked: PeopleHit[];
  setPicked: (f: (s: PeopleHit[]) => PeopleHit[]) => void;
  autoFocus?: boolean;
  /** A private channel's team: its members, and whether outsiders may join it on the way. */
  team?: { members: PeopleHit[]; canAdd: boolean };
}) {
  const [q, setQ] = useState("");
  // Known people, gathered once per open picker (the list barely changes meanwhile).
  const [people] = useState(known);
  const inTeam = useMemo(() => team && new Set(team.members.map((p) => p.mri.toLowerCase())), [team]);
  const pool = useMemo(
    () => (team && inTeam ? [...team.members, ...people.filter((p) => !inTeam.has(p.mri.toLowerCase()))] : people),
    [people, team, inTeam],
  );
  const outsider = (mri: string) => !!inTeam && !inTeam.has(mri.toLowerCase());
  const hits = usePeopleSearch(q, pool, 10);
  const input = useRef<HTMLInputElement>(null);
  const me = myMri();
  const open = hits.filter((h) => h.mri !== me && !exclude(h.mri) && !picked.some((p) => p.mri === h.mri));
  // Outsiders the team can't take stay listed, greyed out, so it's clear why they can't be picked.
  const blocked = team?.canAdd ? [] : open.filter((h) => outsider(h.mri));
  const shown = blocked.length ? open.filter((h) => !blocked.includes(h)) : open;
  const pick = (p: PeopleHit) => {
    setPicked((s) => [...s, p]);
    setQ("");
    input.current?.focus();
  };
  const { hi, setHi, onKey } = usePickerKeys(shown, pick, () => setQ(""));
  return (
    <>
      <div className="tc-newchat-to" onClick={() => input.current?.focus()}>
        {picked.map((p) => (
          <span key={p.mri} className="tc-chip">
            <Avatar name={p.displayName} uri={avatarUri(p.mri)} mri={p.mri} small />
            <span className="tc-chip-name">{p.displayName}</span>
            <button
              onClick={() => setPicked((s) => s.filter((x) => x.mri !== p.mri))}
              aria-label={t().chat.dontAdd(p.displayName)}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus={autoFocus}
          placeholder={picked.length ? t().chat.addMore : t().chat.addPlaceholder}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={(e) => {
            // Escape with an empty box falls through, so the panel can close.
            if (e.key === "Escape" && !q) return;
            if (onKey(e)) {
              e.stopPropagation();
              return;
            }
            if (e.key === "Backspace" && !q && picked.length) setPicked((s) => s.slice(0, -1));
          }}
        />
      </div>
      {shown.length || blocked.length ? (
        <div className="tc-newchat-hits" role="listbox">
          {shown.map((p, i) => (
            <button
              key={p.mri}
              role="option"
              aria-selected={i === hi}
              className={"tc-at-opt" + (i === hi ? " on" : "")}
              ref={i === hi ? scrollNear : undefined}
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                pick(p);
                setHi(0);
              }}
            >
              <Avatar name={p.displayName} uri={avatarUri(p.mri)} mri={p.mri} small />
              <span className="tc-newchat-hit">
                <span className="tc-at-name">{p.displayName}</span>
                {outsider(p.mri) ? (
                  <small className="tc-hit-warn">{t().chat.joinsTeam}</small>
                ) : p.jobTitle || p.email ? (
                  <small>{p.jobTitle || p.email}</small>
                ) : null}
              </span>
            </button>
          ))}
          {blocked.map((p) => (
            <div key={p.mri} role="option" aria-disabled="true" aria-selected={false} className="tc-at-opt off">
              <Avatar name={p.displayName} uri={avatarUri(p.mri)} mri={p.mri} small />
              <span className="tc-newchat-hit">
                <span className="tc-at-name">{p.displayName}</span>
                <small>{t().chat.notInTeam}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export const addLabel = (picked: PeopleHit[]) =>
  picked.length === 1 ? t().chat.addOne(picked[0].displayName.split(" ")[0]) : t().chat.addMany(picked.length);

export function MembersPanel({ chat, known, onClose, onOpenProfile, onAdd, onRemove }: MembersPanelProps) {
  const [picked, setPicked] = useState<PeopleHit[]>([]);
  const [history, setHistory] = useState(0);
  const [busy, setBusy] = useState(false);
  const { armed, tryArm } = useArm<string>();
  const me = myMri();
  useDismiss(true, "#tc-root .tc-members, #tc-root .tc-opts-menu", onClose);

  const add = async () => {
    setBusy(true);
    const ok = await onAdd(chat, picked, history);
    setBusy(false);
    if (ok) setPicked([]);
  };
  const remove = (mri: string) => tryArm(mri, () => void onRemove(chat, mri));

  return (
    <div className="tc-members" role="dialog" aria-label={t().chat.membersOf(chat.title)}>
      <header className="tc-members-head">
        <strong>{t().chat.members}</strong>
        <span className="tc-members-n">{chat.members.length + 1}</span>
        <button className="tc-ghost tc-icon-only" onClick={onClose} aria-label={t().chat.closeMembers}>
          <X size={15} />
        </button>
      </header>

      <div className="tc-members-add">
        <PeoplePicker
          known={known}
          exclude={(m) => chat.members.includes(m)}
          picked={picked}
          setPicked={setPicked}
          autoFocus
        />
        {picked.length ? (
          <div className="tc-members-go">
            <Select
              value={history}
              onChange={(e) => setHistory(Number(e.target.value))}
              aria-label={t().chat.historyLabel}
            >
              {HISTORY.map((h) => (
                <option key={h.days} value={h.days}>
                  {h.label()}
                </option>
              ))}
            </Select>
            <button className="tc-newchat-go" disabled={busy} onClick={() => void add()}>
              <UserPlus size={14} /> {addLabel(picked)}
            </button>
          </div>
        ) : null}
      </div>

      <ul className="tc-members-list">
        <Person mri={me} you onOpen={onOpenProfile} />
        {chat.members.map((m) => (
          <Person key={m} mri={m} armed={armed === m} onOpen={onOpenProfile} onRemove={() => remove(m)} />
        ))}
      </ul>
    </div>
  );
}
