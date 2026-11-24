import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

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
