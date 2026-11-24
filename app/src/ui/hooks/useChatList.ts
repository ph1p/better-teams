import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { listChats, loadProfiles } from "../../teamsData";
import { isIdle, onTeamsChange } from "../lib/live";
import { POLL_MS } from "../lib/constants";
import { read, write } from "../lib/prefs";
import type { Chat } from "../../types";

// Last opened chat, restored after a reload.
const LAST_CHAT = "lastChat";

// Profiles rarely change; a full 10k-row getAll on every tick is waste.
const PROFILES_TTL_MS = 30_000;

// Cheap change signature so polling doesn't re-render (and jump) when idle.
const chatSig = (list: Chat[]) =>
  list
    .map(
      (c) =>
        `${c.id}:${c.time}:${c.unread}:${c.hidden}:${c.channelHidden ? 1 : 0}:${c.title}:${c.liveCall || ""}:${c.muted ? 1 : 0}:${c.group ? 1 : 0}:${c.left ? 1 : 0}:${c.members.length}`,
    )
    .join("|");

export interface ChatList {
  chats: Chat[];
  setChats: Dispatch<SetStateAction<Chat[]>>;
  /** Latest chats for callbacks that must not re-create on every poll. */
  chatsRef: MutableRefObject<Chat[]>;
  error: string;
  sel: string | null;
  setSel: Dispatch<SetStateAction<string | null>>;
}

// Chat list, polled. When nothing is selected yet it reopens the chat open
// before the reload, else the newest one.
export function useChatList(): ChatList {
  const [chats, setChats] = useState<Chat[]>([]);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const lastChatSig = useRef("");

  useEffect(() => {
    let alive = true;
    let profilesAt = 0;
    let reloadProfiles = true;
    const run = async (force?: boolean) => {
      if (!force && isIdle()) return;
      try {
        if (reloadProfiles || Date.now() - profilesAt >= PROFILES_TTL_MS) {
          await loadProfiles();
          profilesAt = Date.now();
          reloadProfiles = false;
        }
        const c = await listChats();
        if (!alive) return;
        setError("");
        const s = chatSig(c);
        if (s !== lastChatSig.current) {
          lastChatSig.current = s;
          setChats(c);
          // A changed list may name new people: refresh profiles next tick.
          reloadProfiles = true;
        }
        setSel((cur) => {
          if (cur) return cur;
          const last = read<string | null>(LAST_CHAT, null);
          return (last && c.some((x) => x.id === last) ? last : c[0]?.id) ?? null;
        });
      } catch (e) {
        if (alive) setError(String((e as Error).message || e));
      }
    };
    // One poll at a time: triggers (interval, DOM changes, chat events) can
    // fire while a slow read is in flight, and a late stale answer must not
    // overwrite a newer one. Coalesce into one trailing run instead.
    let running = false;
    let again: boolean | null = null;
    const tick = async (force?: boolean): Promise<void> => {
      if (running) {
        again = !!(again || force);
        return;
      }
      running = true;
      try {
        await run(force);
      } finally {
        running = false;
      }
      if (again !== null && alive) {
        const f = again;
        again = null;
        void tick(f);
      }
    };
    tick(true);
    const t = setInterval(tick, POLL_MS);
    const offLive = onTeamsChange(() => tick());
    const onVis = () => {
      tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      offLive();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (sel) write(LAST_CHAT, sel);
  }, [sel]);

  const chatsRef = useRef<Chat[]>([]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  return { chats, setChats, chatsRef, error, sel, setSel };
}
