import { useEffect, type RefObject } from "react";
import { useLatest } from "./latest";

// Lets keyboard navigation open the inline editor of a rendered message (E on a
// message picked with the arrow keys). Each own message registers while
// mounted; `back` runs when that edit ends, to return focus to the composer.
type Start = (back?: () => void) => void;
const editors = new Map<string, RefObject<Start>>();

export function requestEdit(id: string, back?: () => void) {
  const start = editors.get(id);
  start?.current(back);
  return !!start;
}

export function useEditRequest(id: string, enabled: boolean, start: Start) {
  const latest = useLatest(start);
  useEffect(() => {
    if (!enabled) return;
    editors.set(id, latest);
    return () => {
      if (editors.get(id) === latest) editors.delete(id);
    };
  }, [id, enabled, latest]);
}
