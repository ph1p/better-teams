// Typing indicator through Teams' web worker (cdl.ts), send and receive.
//
// Send mirrors Teams' composer (bundle, Nov 2026): on every editor change it
// calls a per-chat throttle (`notificationFrequency`, default 6000 ms, leading
// edge only) of ComponentsComposeMessageSendTypingIndicatorMutation, and drops
// the throttle once the message is sent. It never sends while editing a message,
// in a reply chain, for preview/new-chat drafts, in a chat with only me, or in
// a chat above the chat service's group roster limit (default 20 members).
//
// Receive: ComponentsTypingIndicatorTypingUsersQuery for the current state, then
// ComponentsTypingIndicatorTypingUsersSubscription for updates. The worker
// supplies a ready-made, localized label ("X is typing").

import { cdl, cdlSubscribe, type CdlRes } from "./cdl";
import * as D from "./chatDocs";

/** One typing user, as the worker reports it. */
export interface TypingUser {
  id: string;
  avatarUrl?: string | null;
  /** Localized label for the whole set, e.g. "X is typing", "X and Y are typing". */
  typingUsersLabel?: string | null;
  botId?: string | null;
  appId?: string | null;
}

const THROTTLE_MS = 6_000;
const MAX_ROSTER = 20;
const last = new Map<string, number>();

export interface TypingTarget {
  convId: string;
  isChannel: boolean;
  /** MRIs of the OTHER members (Chat.members); I am not counted in it. */
  members: string[];
}

/** Would Teams send a typing signal for this chat? */
export function canSendTyping(t: TypingTarget, editing: boolean): boolean {
  if (!t.convId || editing || t.isChannel) return false;
  if (t.convId.includes("preview-") || t.convId === "newchat") return false;
  const total = t.members.length + 1;
  return total > 1 && total <= MAX_ROSTER;
}

/**
 * Call on every composer change with non-empty content. Sends at most once per
 * THROTTLE_MS per chat (leading edge), exactly like Teams' throttle.
 */
export function notifyTyping(t: TypingTarget, editing = false): void {
  if (!canSendTyping(t, editing)) return;
  const now = Date.now();
  if (now - (last.get(t.convId) ?? 0) < THROTTLE_MS) return;
  last.set(t.convId, now);
  void sendTyping(t.convId);
}

/** Call after a message was sent: Teams cancels the chat's throttle then. */
export function resetTyping(convId: string): void {
  last.delete(convId);
}

/** The bare mutation. Callers normally go through notifyTyping(). */
export async function sendTyping(convId: string): Promise<CdlRes<boolean>> {
  const r = await cdl<{ sendTypingIndicator?: unknown }>(
    "ComponentsComposeMessageSendTypingIndicatorMutation",
    D.TYPING_SEND,
    {
      convId,
    },
  );
  return r.ok ? { ok: true, data: r.data.sendTypingIndicator === true } : r;
}

const asUsers = (v: unknown): TypingUser[] =>
  (Array.isArray(v) ? v : v ? [v] : []).filter((u): u is TypingUser => !!u && typeof (u as TypingUser).id === "string");

/** Who is typing right now. */
export async function typingUsers(convId: string): Promise<CdlRes<TypingUser[]>> {
  const r = await cdl<{ typingUsers?: unknown }>("ComponentsTypingIndicatorTypingUsersQuery", D.TYPING_USERS, {
    convId,
  });
  return r.ok ? { ok: true, data: asUsers(r.data.typingUsers) } : r;
}

/**
 * Follow a chat's typing users: current state first, then every change. `cb`
 * gets the full list each time (empty when nobody types). Returns stop().
 */
export function watchTyping(convId: string, cb: (users: TypingUser[]) => void): () => void {
  let live = true;
  let pushed = false;
  void typingUsers(convId).then((r) => {
    if (live && r.ok && !pushed) cb(r.data);
  });
  const stop = cdlSubscribe<{ typingUsersEvent?: unknown }>(
    "ComponentsTypingIndicatorTypingUsersSubscription",
    D.TYPING_SUB,
    { convId },
    (d) => {
      if (!live) return;
      pushed = true;
      cb(asUsers(d.typingUsersEvent));
    },
  );
  return () => {
    live = false;
    stop();
  };
}
