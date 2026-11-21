import { useEffect, useRef, useState, type JSX } from "react";
import { X } from "lucide-react";
import { t } from "../../i18n";

interface NewChannelProps {
  /** Team the channel goes into, for the title. */
  team: string;
  /** Create it; resolves to an error text, or null once done (App closes the dialog). */
  onCreate: (name: string, description: string, isPrivate: boolean, threads: boolean) => Promise<string | null>;
  onClose: () => void;
}

// "Add channel" dialog, as Teams' own: a name, an optional description,
// standard or private access and the layout (threads, Teams' default, or
// posts). Shared channels are left to Teams.
export function NewChannel({ team, onCreate, onClose }: NewChannelProps): JSX.Element {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [priv, setPriv] = useState(false);
  const [threads, setThreads] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const submit = async (): Promise<void> => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const err = await onCreate(name, desc, priv, threads);
    setBusy(false);
    if (err) setError(err);
  };
  const onKey = (e: { key: string; shiftKey?: boolean; preventDefault: () => void }): void => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  const c = t().chat;
  return (
    <div className="tc-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tc-newchat" role="dialog" aria-label={c.newChannelIn(team)} onKeyDown={onKey}>
        <div className="tc-newchat-head">
          <span>{c.newChannelIn(team)}</span>
          <button className="tc-profile-close" onClick={onClose} title={t().common.close} aria-label={t().common.close}><X size={16} /></button>
        </div>
        <div className="tc-newchat-to" onClick={() => input.current?.focus()}>
          <input
            ref={input}
            value={name}
            maxLength={50}
            placeholder={c.channelName}
            aria-label={c.channelName}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
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
