import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { listChats, loadProfiles } from "../../teamsData";
import { isIdle, onTeamsChange } from "../lib/live";
import { POLL_MS } from "../lib/constants";
import type { Chat } from "../../types";

// Cheap change signature so polling doesn't re-render (and jump) when idle.
const chatSig = (list: Chat[]): string =>
  list
    .map(
      (c) =>
        `${c.id}:${c.time}:${c.unread}:${c.hidden}:${c.title}:${c.liveCall || ""}:${c.muted ? 1 : 0}:${c.group ? 1 : 0}:${c.left ? 1 : 0}:${c.members.length}`,
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

// Chat list, polled. Selects the newest chat when nothing is selected yet.
export function useChatList(): ChatList {
  const [chats, setChats] = useState<Chat[]>([]);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const lastChatSig = useRef("");

  useEffect(() => {
    let alive = true;
    const tick = async (force?: boolean): Promise<void> => {
      if (!force && isIdle()) return;
      try {
        await loadProfiles();
        const c = await listChats();
        if (!alive) return;
        setError("");
        const s = chatSig(c);
        if (s !== lastChatSig.current) {
          lastChatSig.current = s;
          setChats(c);
        }
        setSel((cur) => cur || (c[0] && c[0].id) || null);
      } catch (e) {
        if (alive) setError(String((e as Error).message || e));
      }
    };
    tick(true);
    const t = setInterval(tick, POLL_MS);
    const offLive = onTeamsChange(() => tick());
    const onVis = (): void => {
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

  const chatsRef = useRef<Chat[]>([]);
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  return { chats, setChats, chatsRef, error, sel, setSel };
}
