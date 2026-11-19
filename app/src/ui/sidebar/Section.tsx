import { useState, type JSX, type MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Row } from "./Row";
import { SECTION_CAP } from "../lib/constants";
import type { Chat } from "../../types";

interface SectionProps {
  title: string;
  rows: Chat[];
  sel: string | null;
  onPick: (id: string) => void;
  onOpenProfile: (mri: string) => void;
  onMenu: (e: MouseEvent, chat: Chat) => void;
}

// A collapsible sidebar group (Favorites / Chats / Channels / Meetings). Shows
// the newest SECTION_CAP rows with a "Show more" toggle for the rest.
export function Section({ title, rows, sel, onPick, onOpenProfile, onMenu }: SectionProps): JSX.Element {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const unread = rows.filter((r) => r.unread).length;
  // Show the 10 newest by default; "Show more" reveals the rest. rows arrive
  // already sorted newest-first from listChats.
  const shown = all ? rows : rows.slice(0, SECTION_CAP);
  const hidden = rows.length - shown.length;
  return (
    <>
      <div className="tc-sec" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} className="tc-caret" /> : <ChevronRight size={14} className="tc-caret" />}
        <span className="tc-sec-title">{title}</span>
        <span className="tc-sec-n">{rows.length}</span>
        {!open && unread ? <span className="tc-sec-count">{unread}</span> : null}
      </div>
      {open && (
        <>
          {shown.map((c) => (
            <Row key={c.id} chat={c} selected={c.id === sel} onClick={() => onPick(c.id)} onOpenProfile={onOpenProfile} onMenu={onMenu} />
          ))}
          {rows.length > SECTION_CAP ? (
            <button className="tc-more" onClick={() => setAll((a) => !a)}>
              {all ? "Show less" : `Show ${hidden} more`}
            </button>
          ) : null}
        </>
      )}
    </>
  );
}
