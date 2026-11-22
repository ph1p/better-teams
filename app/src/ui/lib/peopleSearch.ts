// People search as you type: matches from known chats show at once; the org
// directory (substrate, only once Teams itself has used it and its token was
// captured) streams in after a short debounce and is merged behind them.
// Stale answers are dropped.
import { useEffect, useMemo, useState } from "react";
import { searchPeople, type PeopleHit } from "../../teamsData";

const MIN_CHARS = 2;
const LOCAL_MAX = 8;
const DEBOUNCE_MS = 250;
const NONE: PeopleHit[] = [];

/** `known` should be stable (e.g. computed once per mount); it is a dependency. */
export function usePeopleSearch(q: string, known: PeopleHit[], cap: number): PeopleHit[] {
  const term = q.trim().toLowerCase();
  // Lowercased once per `known`, not on every keystroke.
  const index = useMemo(() => known.map((p) => [p, (p.displayName + "\n" + p.email).toLowerCase()] as const), [known]);
  const local = useMemo(
    () =>
      term.length < MIN_CHARS
        ? NONE
        : index
            .filter(([, key]) => key.includes(term))
            .slice(0, LOCAL_MAX)
            .map(([p]) => p),
    [term, index],
  );
  // Directory hits, kept with the term they answer; ignored once it changes.
  const [remote, setRemote] = useState<{ term: string; hits: PeopleHit[] }>({ term: "", hits: NONE });
  useEffect(() => {
    if (term.length < MIN_CHARS) return;
    let live = true;
    const h = setTimeout(() => {
      searchPeople(term, LOCAL_MAX)
        .then((r) => {
          if (live && r.length) setRemote({ term, hits: r });
        })
        .catch(() => {
          /* keep local hits */
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [term]);
  return useMemo(() => {
    if (remote.term !== term) return local;
    const seen = new Set(local.map((p) => p.mri));
    return [...local, ...remote.hits.filter((p) => !seen.has(p.mri))].slice(0, cap);
  }, [local, remote, term, cap]);
}
