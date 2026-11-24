import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Ask Teams once per id; undefined while loading. The setter patches the loaded value. */
export function useLoad<T>(
  id: string,
  load: (id: string) => Promise<T>,
): [T | undefined, Dispatch<SetStateAction<T | undefined>>] {
  const [v, setV] = useState<T | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void load(id).then((x) => {
      if (live) setV(x);
    });
    return () => {
      live = false;
    };
  }, [id, load]);
  return [v, setV];
}
