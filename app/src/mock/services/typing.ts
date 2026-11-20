// Mock of src/services/typing.ts: my own typing goes nowhere; other people's
// typing comes from the store's reply simulation.
import type { CdlRes } from "../../services/cdl";
import type { TypingTarget, TypingUser } from "../../services/typing";
import { nameOf, onTyping, typingIn } from "../store";

export function canSendTyping(t: TypingTarget, editing: boolean): boolean {
  return !!t.convId && !editing && !t.isChannel && t.members.length > 0;
}

export function notifyTyping(_t: TypingTarget, _editing = false): void {}

export function resetTyping(_convId: string): void {}

export async function sendTyping(_convId: string): Promise<CdlRes<boolean>> {
  return { ok: true, data: true };
}

function asUsers(mris: string[]): TypingUser[] {
  if (!mris.length) return [];
  const names = mris.map((m) => nameOf(m).split(" ")[0]);
  const label = names.length === 1 ? `${names[0]} is typing` : `${names.join(" and ")} are typing`;
  return mris.map((id) => ({ id, typingUsersLabel: label }));
}

export async function typingUsers(convId: string): Promise<CdlRes<TypingUser[]>> {
  return { ok: true, data: asUsers(typingIn(convId)) };
}

export function watchTyping(convId: string, cb: (users: TypingUser[]) => void): () => void {
  cb(asUsers(typingIn(convId)));
  return onTyping((id, mris) => {
    if (id === convId) cb(asUsers(mris));
  });
}
