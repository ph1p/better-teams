import { useCallback, useEffect, useRef, useState } from "react";
import { listActivity, markActivityRead } from "../../teamsData";
import { isIdle, onTeamsChange } from "../lib/live";
import { POLL_MS } from "../lib/constants";
import type { Activity } from "../../types";

const sig = (list: Activity[]): string => list.map((a) => `${a.id}:${a.time}:${a.count}:${a.unread ? 1 : 0}`).join("|");

export interface ActivityFeed {
  items: Activity[];
  unread: number;
  /** Read up to the newest item (opening the feed does this). */
  markAllRead: () => void;
}

// Teams' activity feed, polled like the chat list. A failed read keeps the
// last list: the feed is a side view, never worth an error banner.
export function useActivity(): ActivityFeed {
  const [items, setItems] = useState<Activity[]>([]);
  const last = useRef("");
  const itemsRef = useRef<Activity[]>([]);

  useEffect(() => {
    let alive = true;
    let running = false;
    const tick = async (force?: boolean): Promise<void> => {
      if (running || (!force && isIdle())) return;
      running = true;
      try {
        const list = await listActivity();
        const s = sig(list);
        if (alive && s !== last.current) {
          last.current = s;
          itemsRef.current = list;
          setItems(list);
        }
      } catch {
        // Keep the previous list.
      } finally {
        running = false;
      }
    };
    void tick(true);
    const t = setInterval(tick, POLL_MS);
    const offLive = onTeamsChange(() => void tick());
    return () => {
      alive = false;
      clearInterval(t);
      offLive();
    };
  }, []);

  const markAllRead = useCallback((): void => {
    const list = itemsRef.current;
    if (!list.some((a) => a.unread)) return;
    const newest = Math.max(...list.map((a) => a.time));
    const prev = list;
    const next = list.map((a) => ({ ...a, unread: false }));
    itemsRef.current = next;
    last.current = sig(next);
    setItems(next);
    void markActivityRead(newest).then((r) => {
      if (r.ok || itemsRef.current !== next) return;
      itemsRef.current = prev;
      last.current = sig(prev);
      setItems(prev);
    });
  }, []);

  return { items, unread: items.filter((a) => a.unread).length, markAllRead };
}
