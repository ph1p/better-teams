import { useEffect, useState, type JSX } from "react";
import { typing } from "../../services";
import type { TypingUser } from "../../services/typing";
import { profile } from "../../teamsData";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";

const MAX_FACES = 3;
// How long the pill lingers (fading) after the last typer stops.
const LINGER_MS = 220;

function firstName(mri: string): string {
  return (profile(mri).displayName || "").split(/[\s,]+/)[0] || "Someone";
}

// Teams' localized label when it has one, else "Ann", "Ann and Bo",
// "Ann, Bo and 2 others".
function label(users: TypingUser[]): string {
  const native = users[0]?.typingUsersLabel;
  if (native) return native.replace(/[.…]+$/, "");
  const names = users.map((u) => firstName(u.id));
  const who = names.length <= 2 ? names.join(" and ")
    : `${names.slice(0, 2).join(", ")} and ${names.length - 2} other${names.length > 3 ? "s" : ""}`;
  return `${who} ${names.length > 1 ? "are" : "is"} typing`;
}

// Who is typing in the open chat: the typers' faces, an animated dots bubble
// and Teams' label. Floats above the composer so it never shifts the layout.
export function TypingIndicator({ chatId }: { chatId: string }): JSX.Element | null {
  const [users, setUsers] = useState<TypingUser[]>([]);
  const [shown, setShown] = useState<TypingUser[]>([]);

  useEffect(() => {
    setUsers([]);
    setShown([]);
    return typing.watchTyping(chatId, setUsers);
  }, [chatId]);

  // Keep the last typers on screen while the pill fades out.
  useEffect(() => {
    if (users.length) { setShown(users); return; }
    const t = setTimeout(() => setShown([]), LINGER_MS);
    return () => clearTimeout(t);
  }, [users]);

  if (!shown.length) return null;
  const text = label(shown);
  return (
    <div className={"tc-typing" + (users.length ? "" : " out")} role="status" aria-live="polite" aria-label={text}>
      <span className="tc-typing-faces" aria-hidden="true">
        {shown.slice(0, MAX_FACES).map((u) => (
          <Avatar key={u.id} name={profile(u.id).displayName || ""} uri={u.avatarUrl || avatarUri(u.id)} small />
        ))}
      </span>
      <span className="tc-typing-dots" aria-hidden="true"><i /><i /><i /></span>
      <span className="tc-typing-text">{text}</span>
    </div>
  );
}
