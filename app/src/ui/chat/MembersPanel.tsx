// A group chat's members, under the chat header: everyone in the chat, a
// remove button per person (first click arms, second removes), and a search
// box to add people. Local matches from known chats show at once; the
// directory search streams in after a short debounce (lib/peopleSearch).

import { t } from "../../i18n";
import { useRef, useState, type JSX } from "react";
import { Trash2, UserPlus, X } from "lucide-react";
import { myMri, profile, type PeopleHit } from "../../teamsData";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { useDismiss } from "../lib/dismiss";
import { useArm } from "../lib/arm";
import { usePeopleSearch } from "../lib/peopleSearch";
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

/**
 * One row: avatar, name and job title (from the cached profile unless given),
 * an optional badge, and a remove button that arms on the first click.
 */
export function Person({ mri, name, sub, badge, you, armed, removeTitle, onOpen, onRemove }: {
  mri: string; name?: string; sub?: string; badge?: string; you?: boolean; armed?: boolean;
  removeTitle?: string; onOpen: (mri: string) => void; onRemove?: () => void;
}): JSX.Element {
  const p = profile(mri);
  const shown = p.displayName || name || t().common.unknown;
  const job = p.jobTitle || sub;
  return (
    <li className="tc-member">
      <Avatar name={shown} uri={avatarUri(mri)} mri={mri} small onOpen={onOpen} />
      <span className="tc-member-text">
        <span className="tc-member-name">{shown}{you ? <span className="tc-member-you">{t().chat.youSuffix}</span> : null}</span>
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
          {armed ? <><Trash2 size={13} /> {t().common.remove}</> : <X size={14} />}
        </button>
      ) : null}
    </li>
  );
}

/**
 * Chips for the people picked so far, a search box, and its matches: local
 * ones at once, the directory's after a short debounce. Enter picks the top
 * match, Backspace in an empty box drops the last chip. `exclude` hides people
 * who are in already.
 */
export function PeoplePicker({ known, exclude, picked, setPicked, autoFocus }: {
  known: () => PeopleHit[];
  exclude: (mri: string) => boolean;
  picked: PeopleHit[];
  setPicked: (f: (s: PeopleHit[]) => PeopleHit[]) => void;
  autoFocus?: boolean;
}): JSX.Element {
  const [q, setQ] = useState("");
  // Known people, gathered once per open picker (the list barely changes meanwhile).
  const [people] = useState(known);
  const hits = usePeopleSearch(q, people, 10);
  const input = useRef<HTMLInputElement>(null);
  const me = myMri();
  const shown = hits.filter((h) => h.mri !== me && !exclude(h.mri) && !picked.some((p) => p.mri === h.mri));
  const pick = (p: PeopleHit): void => { setPicked((s) => [...s, p]); setQ(""); input.current?.focus(); };
  return (
    <>
      <div className="tc-newchat-to" onClick={() => input.current?.focus()}>
        {picked.map((p) => (
          <span key={p.mri} className="tc-chip">
            <span className="tc-chip-name">{p.displayName}</span>
            <button onClick={() => setPicked((s) => s.filter((x) => x.mri !== p.mri))} aria-label={t().chat.dontAdd(p.displayName)}><X size={12} /></button>
          </span>
        ))}
        <input
          ref={input}
          autoFocus={autoFocus}
          placeholder={picked.length ? t().chat.addMore : t().chat.addPlaceholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) { e.preventDefault(); pick(shown[0]); }
            else if (e.key === "Backspace" && !q && picked.length) setPicked((s) => s.slice(0, -1));
          }}
        />
      </div>
      {shown.length ? (
        <div className="tc-newchat-hits" role="listbox">
          {shown.map((p) => (
            <button key={p.mri} role="option" className="tc-at-opt" onClick={() => pick(p)}>
              <Avatar name={p.displayName} uri={avatarUri(p.mri)} mri={p.mri} small />
              <span className="tc-newchat-hit">
                <span className="tc-at-name">{p.displayName}</span>
                {p.jobTitle || p.email ? <small>{p.jobTitle || p.email}</small> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

/** "Add Anna" / "Add 3 people", for the picker's go button. */
export const addLabel = (picked: PeopleHit[]): string =>
  picked.length === 1 ? t().chat.addOne(picked[0].displayName.split(" ")[0]) : t().chat.addMany(picked.length);

export function MembersPanel({ chat, known, onClose, onOpenProfile, onAdd, onRemove }: MembersPanelProps): JSX.Element {
  const [picked, setPicked] = useState<PeopleHit[]>([]);
  const [history, setHistory] = useState(0);
  const [busy, setBusy] = useState(false);
  const { armed, tryArm } = useArm<string>();
  const me = myMri();
  useDismiss(true, "#tc-root .tc-members, #tc-root .tc-opts-menu", onClose);

  const add = async (): Promise<void> => {
    setBusy(true);
    const ok = await onAdd(chat, picked, history);
    setBusy(false);
    if (ok) setPicked([]);
  };
  const remove = (mri: string): void => tryArm(mri, () => void onRemove(chat, mri));

  return (
    <div className="tc-members" role="dialog" aria-label={t().chat.membersOf(chat.title)}>
      <header className="tc-members-head">
        <strong>{t().chat.members}</strong>
        <span className="tc-members-n">{chat.members.length + 1}</span>
        <button className="tc-ghost tc-icon-only" onClick={onClose} aria-label={t().chat.closeMembers}><X size={15} /></button>
      </header>

      <div className="tc-members-add">
        <PeoplePicker known={known} exclude={(m) => chat.members.includes(m)} picked={picked} setPicked={setPicked} autoFocus />
        {picked.length ? (
          <div className="tc-members-go">
            <select value={history} onChange={(e) => setHistory(Number(e.target.value))} aria-label={t().chat.historyLabel}>
              {HISTORY.map((h) => <option key={h.days} value={h.days}>{h.label()}</option>)}
            </select>
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
