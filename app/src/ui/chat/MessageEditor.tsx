import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode, type RefObject } from "react";
import { Hash, Smile, SquareCode, Users } from "lucide-react";
import { getChannelActions, listChannelMembers, myMri, profile, searchPeople } from "../../teamsData";
import { typing } from "../../services";
import { EmojiPicker } from "../shared/EmojiPicker";
import { Avatar } from "../shared/Avatar";
import { avatarUri } from "../lib/format";
import { useDismiss } from "../lib/dismiss";
import { useChanged } from "../lib/changed";
import { fenceAt, handleFormatKey, putCodeBlock, replaceText, type Fence } from "../lib/editKeys";
import { CodeDialog } from "./CodeDialog";
import { highlightDraft, mentionRe, type Seg } from "../lib/draftHighlight";
import { highlightLines, initHighlighter, onHighlighterReady } from "../../highlight";
import { searchShortcodes, shortcodeGlyph } from "../lib/reactions";
import { inOpenFence } from "../../markdown";
import type { Chat } from "../../types";
import type { MentionPick } from "../../mentions";
import { t } from "../../i18n";
import { scrollNear } from "../lib/pickerKeys";

const NO_PICKS: MentionPick[] = [];

// A channel's people for @mentions: its own roster (private/shared) or the
// team's (standard). Fetched on the first "@"; data/groups.ts caches it.
function channelRoster(channelId: string): Promise<MentionPick[]> {
  return getChannelActions(channelId)
    .then((a) => (a ? listChannelMembers(a) : null))
    .then((ms) => (ms ?? []).map((m): MentionPick => ({ mri: m.mri, name: m.displayName, mentionType: "person" })))
    .catch(() => NO_PICKS);
}

// "@query" and ":name" being typed before the caret, and a finished ":name:" (auto-replaced).
const AT_Q = /(?:^|\s)@([^\s@]{0,40})$/;
const EMOJI_Q = /(?:^|[\s(]):([a-z0-9_+-]{2,30})$/i;
const EMOJI_DONE = /(?:^|[\s(]):([a-z0-9_+-]{2,30}):$/i;
// Keeps the arrow-selected popup row visible.
// The end-anchored popup regexes only need the text just before the caret.
const tail = (upto: string): string => upto.slice(-48);
// Caret inside a code fence or an open `code span` on its line: no emoji there.
const inCode = (upto: string): boolean =>
  inOpenFence(upto) || upto.slice(upto.lastIndexOf("\n") + 1).split("`").length % 2 === 0;
const plainEnter = (e: React.KeyboardEvent): boolean => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing;

export interface MessageEditorProps {
  /** Where the text goes: members feed the @mention picker, id the typing signal. */
  chat: Pick<Chat, "id" | "isChannel" | "members"> & Partial<Pick<Chat, "title" | "team" | "teamId" | "channelType">>;
  value: string;
  onChange: (v: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** @mentions inserted so far (highlighted; the caller sends them). */
  picks: readonly MentionPick[];
  onPick: (pick: MentionPick) => void;
  /** Enter (no Shift) with no popup open. */
  onSubmit: () => void;
  /** Escape with no popup open; true when handled. */
  onEscape?: () => boolean;
  /** Arrow Up in an empty editor; true when handled. */
  onUpEmpty?: () => boolean;
  /** Files pasted into the field; without it a paste is text only. */
  onFiles?: (files: FileList) => void;
  placeholder?: string;
  /** Send Teams' "typing" signal while the text is non-empty. */
  notifyTyping?: boolean;
  /** Focus on mount, caret at the end. */
  autoFocus?: boolean;
  /** Toolbar content before the emoji / code block buttons. */
  lead?: ReactNode;
  /** Content after the text field (e.g. the send button). */
  trail?: ReactNode;
  className?: string;
}

// The text editor shared by the composer and inline message edits: live
// markdown backdrop, @mention autocomplete (chat members + org directory),
// ":emoji:" autocomplete and auto-replace, the emoji picker, the code block
// button, format keys (ui/lib/editKeys.ts) and auto-grow. Popups anchor above
// the .tc-editor box.
export function MessageEditor(p: MessageEditorProps): JSX.Element {
  const { chat, value: draft, inputRef } = p;
  // @-autocomplete popup: open flag + current filter query (text after the @).
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  // Org-directory @mention hits (debounced searchPeople), merged after local members.
  // Kept with the query they answer; shown only while that query is current.
  const [org, setOrg] = useState<{ q: string; hits: MentionPick[] }>({ q: "", hits: NO_PICKS });
  const atOrg = atOpen && org.q === atQuery.trim() ? org.hits : NO_PICKS;
  // Channels: the roster, loaded once the @-picker first opens there.
  const [roster, setRoster] = useState<{ id: string; picks: MentionPick[] }>({ id: "", picks: NO_PICKS });
  const atRoster = roster.id === chat.id ? roster.picks : NO_PICKS;
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Code block dialog: the draft range it writes over (the fence the caret is
  // in, else the selection) and the block to start from.
  const [codeAt, setCodeAt] = useState<(Fence & { isNew: boolean }) | null>(null);
  // ":smi" emoji autocomplete: the query after the colon, or null when closed.
  const [emQuery, setEmQuery] = useState<string | null>(null);
  const emHits = useMemo(() => (emQuery ? searchShortcodes(emQuery) : []), [emQuery]);
  // Highlighted row of whichever popup is open (arrow keys move it).
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const atRe = useMemo(() => mentionRe(p.picks.map((x) => x.name)), [p.picks]);
  // Fenced code is colored once Shiki has loaded (`ready` re-runs the memo then).
  const [ready, bump] = useState(0);
  const hasFence = draft.includes("```");
  useEffect(() => {
    if (!hasFence) return;
    initHighlighter();
    return onHighlighterReady(() => bump((n) => n + 1));
  }, [hasFence]);
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const hl = useMemo(() => renderSegs(highlightDraft(draft, atRe, highlightLines)), [draft, atRe, ready]);

  // Replace [start, end) of the textarea with `ins`, caret after it. Goes
  // through the native edit path, so Cmd+Z undoes it; onChange then syncs the draft.
  const splice = (start: number, end: number, ins: string): void => {
    const el = inputRef.current;
    if (el) replaceText(el, start, end, ins);
  };
  const insertAtCaret = (ins: string): void => {
    const el = inputRef.current;
    if (!el) p.onChange(draft + ins);
    else splice(el.selectionStart ?? draft.length, el.selectionEnd ?? draft.length, ins);
  };

  // Resolved, filtered @mention candidates whose name matches the text typed
  // after the "@": in a channel the channel itself and its team (as Teams
  // offers them; a private or shared channel can't mention the whole team),
  // then the chat's members or channel roster (minus me), then org-directory hits.
  const myself = myMri();
  const atCandidates = useMemo<MentionPick[]>(() => {
    if (!atOpen) return NO_PICKS;
    const q = atQuery.trim().toLowerCase();
    const hit = (name: string): boolean => !!name && (!q || name.toLowerCase().includes(q));
    const groups: MentionPick[] = [];
    if (chat.isChannel) {
      if (chat.title && hit(chat.title)) groups.push({ mri: chat.id, name: chat.title, mentionType: "channel" });
      if (chat.teamId && chat.team && !chat.channelType && hit(chat.team))
        groups.push({ mri: chat.teamId, name: chat.team, mentionType: "team" });
    }
    const seen = new Set<string>();
    const out: MentionPick[] = [];
    const people = [
      ...chat.members.map((mri) => ({ mri, name: profile(mri).displayName || "", mentionType: "person" })),
      ...atRoster,
    ];
    for (const x of people) {
      if (!x.mri || x.mri === myself || seen.has(x.mri)) continue;
      seen.add(x.mri);
      if (hit(x.name)) out.push(x);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    out.unshift(...groups);
    for (const x of atOrg) {
      if (!x.mri || x.mri === myself || seen.has(x.mri)) continue;
      seen.add(x.mri);
      out.push(x);
    }
    return out.slice(0, 8);
  }, [chat, atOpen, atQuery, myself, atOrg, atRoster]);

  // Track an "@word" or ":word" the caret sits at the end of; any other edit
  // closes its popup. A finished ":name:" becomes its emoji, like Slack.
  const onDraftChange = (v: string): void => {
    p.onChange(v);
    // Teams signals typing on every non-empty editor change (throttled per chat).
    if (p.notifyTyping && v.trim())
      typing.notifyTyping({ convId: chat.id, isChannel: chat.isChannel, members: chat.members });
    const caret = inputRef.current?.selectionStart ?? v.length;
    const upto = v.slice(0, caret);
    const end = tail(upto);
    const m = AT_Q.exec(end);
    setAtOpen(!!m);
    setAtQuery(m ? m[1] : "");
    setActive(0);
    const done = EMOJI_DONE.exec(end);
    const glyph = done && shortcodeGlyph(done[1]);
    if (glyph && done && !inCode(upto)) {
      setEmQuery(null);
      splice(caret - done[1].length - 2, caret, glyph);
      return;
    }
    const em = m ? null : EMOJI_Q.exec(end);
    setEmQuery(em && !inCode(upto) ? em[1] : null);
  };

  // Replace the half-typed ":query" at the caret with the emoji.
  const pickEmoji = (glyph: string): void => {
    const caret = inputRef.current?.selectionStart ?? draft.length;
    const em = EMOJI_Q.exec(tail(draft.slice(0, caret)));
    setEmQuery(null);
    splice(em ? caret - em[1].length - 1 : caret, caret, glyph);
  };

  // Replace the half-typed "@query" at the caret with "@Display Name " and
  // record the pick so the send path emits a real mention span.
  const pickMention = (pick: MentionPick): void => {
    const caret = inputRef.current?.selectionStart ?? draft.length;
    const m = AT_Q.exec(tail(draft.slice(0, caret)));
    p.onPick(pick);
    setAtOpen(false);
    setAtQuery("");
    splice(m ? caret - m[1].length - 1 : caret, caret, "@" + pick.name + " ");
  };

  // The open popup (@mention wins over :emoji): row count, pick, close.
  const pop: "at" | "em" | null = atCandidates.length ? "at" : emHits.length ? "em" : null;
  const popN = pop === "at" ? atCandidates.length : emHits.length;
  const on = pop ? Math.min(active, popN - 1) : 0;
  const popPick = (i: number) => (pop === "at" ? pickMention(atCandidates[i]) : pickEmoji(emHits[i].glyph));
  const popClose = () => (pop === "at" ? setAtOpen(false) : setEmQuery(null));
  const optProps = (i: number) => ({
    className: "tc-at-opt" + (i === on ? " on" : ""),
    ref: i === on ? scrollNear : undefined,
    onMouseEnter: () => setActive(i),
    onClick: () => popPick(i),
  });
  const closePops = (): void => {
    setAtOpen(false);
    setAtQuery("");
    setEmQuery(null);
  };

  const openCode = (): void => {
    const el = inputRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const f = fenceAt(el.value, s);
    setCodeAt(f ? { ...f, isNew: false } : { start: s, end: e, lang: "", code: el.value.slice(s, e), isNew: true });
  };
  const closeCode = (): void => {
    setCodeAt(null);
    inputRef.current?.focus();
  };

  if (useChanged(chat.id)) {
    closePops();
    setEmojiOpen(false);
  }

  useEffect(() => {
    if (!atOpen || !chat.isChannel || roster.id === chat.id) return;
    let live = true;
    void channelRoster(chat.id).then((picks) => {
      if (live) setRoster({ id: chat.id, picks });
    });
    return () => {
      live = false;
    };
  }, [atOpen, chat.isChannel, chat.id, roster.id]);

  // Debounced org-directory search while the @-picker is open. Local members
  // show at once; org hits stream in ~250ms after typing stops. The `live`
  // guard drops stale responses so an older query can't overwrite a newer one.
  useEffect(() => {
    const q = atQuery.trim();
    if (!atOpen || q.length < 2) return;
    let live = true;
    const h = setTimeout(() => {
      searchPeople(q, 8)
        .then((hits) => {
          if (live) setOrg({ q, hits: hits.map((x) => ({ mri: x.mri, name: x.displayName, mentionType: "person" })) });
        })
        .catch(() => {
          /* keep local-only candidates */
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [atOpen, atQuery]);

  // Auto-grow up to the CSS max-height, then scroll; keep the backdrop aligned.
  // Grow the box to its text. While the app is hidden (switched to Teams) the
  // box has no layout and measures 0, so wait until it shows again.
  const fit = (): void => {
    const el = inputRef.current;
    if (!el || !el.getClientRects().length) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
    if (hlRef.current) hlRef.current.scrollTop = el.scrollTop;
  };
  useLayoutEffect(fit, [draft, chat.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coming back into view, or a new width, changes the wrapping: measure again.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = -1;
    const ro = new ResizeObserver(([e]) => {
      if (e.contentRect.width === width) return;
      width = e.contentRect.width;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = inputRef.current;
    if (!p.autoFocus || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Close the emoji picker on any outside click, scroll, Escape, or resize; the
  // picker and its toggle button count as inside.
  useDismiss(emojiOpen, "#tc-root .tc-emoji-pop, #tc-root .tc-emoji-btn", () => setEmojiOpen(false));

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Open @mention or :emoji popup: arrows move, Enter / Tab pick, Escape closes.
    if (pop) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((on + (e.key === "ArrowDown" ? 1 : popN - 1)) % popN);
        return;
      }
      if (plainEnter(e) || e.key === "Tab") {
        e.preventDefault();
        popPick(on);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        popClose();
        return;
      }
    }
    if (handleFormatKey(e, openCode)) return;
    if (e.key === "Escape" && p.onEscape?.()) {
      e.preventDefault();
      return;
    }
    const mod = e.shiftKey || e.altKey || e.metaKey || e.ctrlKey;
    if (e.key === "ArrowUp" && !mod && !draft && p.onUpEmpty?.()) {
      e.preventDefault();
      return;
    }
    if (plainEnter(e)) {
      e.preventDefault();
      closePops();
      p.onSubmit();
    }
  };

  return (
    <div className={"tc-editor" + (p.className ? " " + p.className : "")} ref={root}>
      {codeAt ? (
        <CodeDialog
          code={codeAt.code}
          lang={codeAt.isNew ? null : codeAt.lang}
          onDone={(code, lang) => {
            if (inputRef.current) putCodeBlock(inputRef.current, codeAt.start, codeAt.end, lang, code);
          }}
          onClose={closeCode}
        />
      ) : null}
      {emojiOpen ? (
        <div className="tc-emoji-pop" onMouseDown={(e) => e.stopPropagation()}>
          <EmojiPicker
            onPick={(em) => {
              insertAtCaret(em);
              setEmojiOpen(false);
            }}
          />
        </div>
      ) : null}
      {pop === "at" ? (
        <div className="tc-at-pop" onMouseDown={(e) => e.preventDefault()}>
          {atCandidates.map((c, i) => (
            <button key={c.mri} {...optProps(i)}>
              {c.mentionType === "person" ? (
                <Avatar name={c.name} uri={avatarUri(c.mri)} mri={c.mri} small />
              ) : (
                <span className="tc-at-glyph" aria-hidden>
                  {c.mentionType === "team" ? <Users size={14} /> : <Hash size={14} />}
                </span>
              )}
              <span className="tc-at-name">{c.name}</span>
              {c.mentionType === "person" ? null : (
                <small className="tc-at-kind">
                  {c.mentionType === "team" ? t().chat.mentionTeam : t().chat.mentionChannel}
                </small>
              )}
            </button>
          ))}
        </div>
      ) : pop === "em" ? (
        <div className="tc-at-pop tc-em-pop" onMouseDown={(e) => e.preventDefault()}>
          {emHits.map((h, i) => (
            <button key={h.name} {...optProps(i)}>
              <span className="tc-em-glyph">{h.glyph}</span>
              <span className="tc-at-name">:{h.name}:</span>
            </button>
          ))}
        </div>
      ) : null}
      {/* Several lines: the text takes the full width, the buttons a row below. */}
      <div className={"tc-composer-box" + (draft.includes("\n") ? " tall" : "")}>
        {p.lead}
        <button
          className="tc-emoji-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => setEmojiOpen((o) => !o)}
          title={t().composer.emoji}
          aria-label={t().composer.emoji}
          aria-expanded={emojiOpen}
        >
          <Smile size={18} />
        </button>
        <button
          className="tc-emoji-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openCode}
          title={t().composer.codeBlockTitle}
          aria-label={t().composer.insertCodeBlock}
        >
          <SquareCode size={18} />
        </button>
        <div className="tc-composer-field">
          {/* Styled copy of the draft behind the (transparent-text) textarea. */}
          <div className="tc-composer-hl" ref={hlRef} aria-hidden>
            {hl}
          </div>
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={p.placeholder}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onScroll={(e) => {
              if (hlRef.current) hlRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onSelect={(e) => {
              // Moving the caret away from a ":query" closes its popup.
              if (emQuery === null) return;
              const el = e.currentTarget;
              if (!EMOJI_Q.test(tail(el.value.slice(0, el.selectionStart)))) setEmQuery(null);
            }}
            onBlur={(e) => {
              // Tabbing / clicking out closes the autocomplete (its rows keep focus via preventDefault).
              if (!root.current?.contains(e.relatedTarget as Node | null)) closePops();
            }}
            onPaste={(e) => {
              if (!p.onFiles || !e.clipboardData.files.length) return;
              e.preventDefault();
              p.onFiles(e.clipboardData.files);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {p.trail}
      </div>
    </div>
  );
}

// Backdrop segments → React nodes (no innerHTML: Teams enforces Trusted Types).
function renderSegs(segs: Seg[]): (string | JSX.Element)[] {
  return segs.map((s, i) =>
    typeof s === "string" ? (
      s
    ) : (
      <span key={i} className={s.cls || undefined} style={s.color ? { color: s.color } : undefined}>
        {renderSegs(s.kids)}
      </span>
    ),
  );
}
