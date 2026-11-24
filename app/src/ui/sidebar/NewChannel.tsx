import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { t } from "../../i18n";
import type { PeopleHit } from "../../teamsData";
import { PeoplePicker } from "../chat/MembersPanel";
import { useModalExit } from "../lib/modalExit";

interface NewChannelProps {
  /** Team the channel goes into, for the title. */
  team: string;
  /** People for the private channel's picker (known chats, then the directory). */
  known: () => PeopleHit[];
  /**
   * Create it, with `people` added to a private one; resolves to an error
   * text, or null once done (App closes the dialog).
   */
  onCreate: (
    name: string,
    description: string,
    isPrivate: boolean,
    threads: boolean,
    people: PeopleHit[],
  ) => Promise<string | null>;
  onClose: () => void;
}

// "Add channel" dialog, as Teams' own (threads is Teams' default layout).
// Shared channels are left to Teams.
export function NewChannel({ team, known, onCreate, onClose }: NewChannelProps) {
  const { closing, close } = useModalExit(onClose);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [priv, setPriv] = useState(false);
  const [threads, setThreads] = useState(true);
  const [people, setPeople] = useState<PeopleHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await onCreate(name, desc, priv, threads, priv ? people : []);
    setBusy(false);
    if (err) setError(err);
  };
  const onKey = (e: { key: string; shiftKey?: boolean; preventDefault: () => void }) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const c = t().chat;
  return (
    <div
      className={"tc-scrim" + (closing ? " out" : "")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="tc-newchat" role="dialog" aria-label={c.newChannelIn(team)} onKeyDown={onKey}>
        <div className="tc-newchat-head">
          <span>{c.newChannelIn(team)}</span>
          <button className="tc-profile-close" onClick={close} title={t().common.close} aria-label={t().common.close}>
            <X size={16} />
          </button>
        </div>
        <div className="tc-newchat-to" onClick={() => input.current?.focus()}>
          <input
            ref={input}
            value={name}
            maxLength={50}
            placeholder={c.channelName}
            aria-label={c.channelName}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <textarea
          className="tc-newchat-msg"
          rows={2}
          value={desc}
          maxLength={1024}
          placeholder={c.channelDescription}
          aria-label={c.channelDescription}
          onChange={(e) => setDesc(e.target.value)}
        />
        <label className="tc-newchat-check">
          <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
          <span>{c.channelPrivate}</span>
        </label>
        {priv ? (
          <div className="tc-newchat-people" aria-label={c.channelAddPeople}>
            <small>{c.channelAddPeople}</small>
            <PeoplePicker known={known} exclude={() => false} picked={people} setPicked={setPeople} />
          </div>
        ) : null}
        <div className="tc-newchat-layout" role="radiogroup" aria-label={c.channelLayout}>
          <span>{c.channelLayout}</span>
          <label className="tc-newchat-check">
            <input type="radio" name="tc-channel-layout" checked={threads} onChange={() => setThreads(true)} />
            <span>{c.channelThreads}</span>
          </label>
          <label className="tc-newchat-check">
            <input type="radio" name="tc-channel-layout" checked={!threads} onChange={() => setThreads(false)} />
            <span>{c.channelPosts}</span>
          </label>
        </div>
        {error ? <div className="tc-newchat-note">{error}</div> : null}
        <div className="tc-newchat-foot">
          <small>{priv ? c.channelPrivateNote : c.channelStandardNote}</small>
          <button className="tc-newchat-go" disabled={!name.trim() || busy} onClick={() => void submit()}>
            {busy ? c.creatingChannel : c.createChannel}
          </button>
        </div>
      </div>
    </div>
  );
}
