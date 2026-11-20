// People search as you type: matches from known chats show at once; the org
// directory (substrate, only once Teams itself has used it and its token was
// captured) streams in after a short debounce and is merged behind them.
// Stale answers are dropped.
import { useEffect, useMemo, useState } from "react";
import { searchPeople, type PeopleHit } from "../../teamsData";

const MIN_CHARS = 2;
const LOCAL_MAX = 8;
const DEBOUNCE_MS = 250;

/** `known` should be stable (e.g. computed once per mount); it is a dependency. */
export function usePeopleSearch(q: string, known: PeopleHit[], cap: number): PeopleHit[] {
  const [hits, setHits] = useState<PeopleHit[]>([]);
  // Lowercased once per `known`, not on every keystroke.
  const index = useMemo(() => known.map((p) => [p, (p.displayName + "\n" + p.email).toLowerCase()] as const), [known]);
  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (term.length < MIN_CHARS) { setHits([]); return; }
    const local = index.filter(([, key]) => key.includes(term)).slice(0, LOCAL_MAX).map(([p]) => p);
    setHits(local);
    let live = true;
    const h = setTimeout(() => {
      searchPeople(term, LOCAL_MAX)
        .then((r) => {
          if (!live || !r.length) return;
          const seen = new Set(local.map((p) => p.mri));
          setHits([...local, ...r.filter((p) => !seen.has(p.mri))].slice(0, cap));
        })
        .catch(() => { /* keep local hits */ });
    }, DEBOUNCE_MS);
    return () => { live = false; clearTimeout(h); };
  }, [q, index, cap]);
  return hits;
}
