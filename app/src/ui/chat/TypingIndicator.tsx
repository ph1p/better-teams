import { t } from "../../i18n";
import { shortName, useNameFormat } from "../../names";
import { useEffect, useState, type JSX } from "react";
import { useChanged } from "../lib/changed";
import { typing } from "../../services";
import type { TypingUser } from "../../services/typing";
import { profile } from "../../teamsData";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";

const MAX_FACES = 3;
// How long the pill lingers (fading) after the last typer stops.
const LINGER_MS = 220;

function firstName(mri: string): string {
  return shortName(profile(mri)) || t().chat.someone;
}

// Teams' localized label when it has one, else "Ann", "Ann and Bo",
// "Ann, Bo and 2 others".
function label(users: TypingUser[]): string {
  const native = users[0]?.typingUsersLabel;
  if (native) return native.replace(/[.…]+$/, "");
  const names = users.map((u) => firstName(u.id));
  const who =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? t().chat.typingTwo(names[0], names[1])
        : t().chat.typingMore(names[0], names[1], names.length - 2);
  return t().chat.isTyping(who, names.length > 1);
}

// Who is typing in the open chat: the typers' faces, an animated dots bubble
// and Teams' label. Floats above the composer so it never shifts the layout.
export function TypingIndicator({ chatId }: { chatId: string }): JSX.Element | null {
  useNameFormat();
  const [users, setUsers] = useState<TypingUser[]>([]);
  // Last non-empty typers, kept on screen while the pill fades out.
  const [last, setLast] = useState<TypingUser[]>([]);
  if (useChanged(chatId)) {
    setUsers([]);
    setLast([]);
  } else if (users.length && users !== last) {
    setLast(users);
  }

  useEffect(() => typing.watchTyping(chatId, setUsers), [chatId]);

  useEffect(() => {
    if (users.length) return;
    const h = setTimeout(() => setLast([]), LINGER_MS);
    return () => clearTimeout(h);
  }, [users]);

  const shown = users.length ? users : last;

  if (!shown.length) return null;
  const text = label(shown);
  return (
    <div className={"tc-typing" + (users.length ? "" : " out")} role="status" aria-live="polite" aria-label={text}>
      <span className="tc-typing-faces" aria-hidden="true">
        {shown.slice(0, MAX_FACES).map((u) => (
          // Our cached/live photo first: the worker's avatarUrl is often a
          // placeholder silhouette that renders as an empty grey disc.
          <Avatar key={u.id} name={profile(u.id).displayName || firstName(u.id)} uri={avatarUri(u.id) || u.avatarUrl || ""} small />
        ))}
      </span>
      <span className="tc-typing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="tc-typing-text">{text}</span>
    </div>
  );
}
