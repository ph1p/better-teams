import { Fragment, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import type { Card } from "../../cards";
import { GatedImg } from "../../richText";
import { isTrustedImgHost, safeHref, safeImgSrc } from "../../safeUrl";
import { locale, t } from "../../i18n";

// Renders bot / connector cards (Jira, Workflows, Forms, …) the way Teams
// does, for the subset of Adaptive Cards that bots actually send: text, rich
// text, containers, columns, images, fact sets, tables and actions. Hero,
// thumbnail and O365 connector cards are mapped onto the same elements first.
//
// Read-only: actions that would post back to the bot (Submit / Execute) and
// inputs need Teams' bot invoke, so those buttons hand off to Teams instead.

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): Dict[] => (Array.isArray(v) ? v.filter(isDict) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

interface Ctx {
  hidden: Record<string, boolean>;
  toggle: (ids: string[]) => void;
  openInTeams?: () => void;
}

// --- Inline markdown (the subset Adaptive Cards support) ---------------------

// {{DATE(2026-11-23T15:58:00Z, SHORT)}} / {{TIME(…)}} -> localized text.
function expandDates(s: string): string {
  return s.replace(
    /\{\{(DATE|TIME)\(([^,)]+)(?:,\s*(SHORT|LONG|COMPACT))?\)\}\}/g,
    (all, fn: string, iso: string, fmt) => {
      const d = new Date(iso.trim());
      if (isNaN(d.getTime())) return all;
      if (fn === "TIME") return d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
      const style = fmt === "LONG" ? "full" : fmt === "SHORT" ? "medium" : "short";
      return d.toLocaleDateString(locale(), { dateStyle: style });
    },
  );
}

const INLINE =
  /\*\*(.+?)\*\*|__(.+?)__|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)([^*]+?)\*(?![\w*])|(?<![\w_])_(?!\s)([^_]+?)_(?![\w_])|<at>(.*?)<\/at>/g;

function inline(s: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = key + "-" + n++;
    if (m[1] !== undefined || m[2] !== undefined) out.push(<strong key={k}>{inline(m[1] ?? m[2], k)}</strong>);
    else if (m[3] !== undefined) {
      const href = safeHref(m[4]);
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noreferrer noopener">
            {inline(m[3], k)}
          </a>
        ) : (
          m[3]
        ),
      );
    } else if (m[5] !== undefined || m[6] !== undefined) out.push(<em key={k}>{m[5] ?? m[6]}</em>);
    else out.push(<strong key={k}>{m[7]}</strong>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** Card text: markdown lines, "- " / "1. " lists, line breaks. */
function Md({ text }: { text: string }): JSX.Element {
  const lines = decode(expandDates(text.replace(/<br\s*\/?>/gi, "\n").replace(/<(?!\/?at>)[^>]+>/g, ""))).split(
    /\r?\n/,
  );
  const out: ReactNode[] = [];
  let items: ReactNode[] = [];
  let ordered = false;
  const flush = (): void => {
    if (!items.length) return;
    const L = ordered ? "ol" : "ul";
    out.push(<L key={"l" + out.length}>{items}</L>);
    items = [];
  };
  lines.forEach((line, i) => {
    const li = /^\s*(?:([-*•])|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      if (items.length && ordered !== !!li[2]) flush();
      ordered = !!li[2];
      items.push(<li key={i}>{inline(li[3], "i" + i)}</li>);
      return;
    }
    flush();
    if (out.length) out.push(<br key={"b" + i} />);
    out.push(<Fragment key={"t" + i}>{inline(line, "t" + i)}</Fragment>);
  });
  flush();
  return <>{out}</>;
}

// --- Elements ----------------------------------------------------------------

const SIZES: Record<string, number> = { small: 24, medium: 40, large: 72 };
const px = (v: unknown): number => {
  const m = /^(\d+)px$/.exec(str(v));
  return m ? Number(m[1]) : 0;
};

function textCls(e: Dict, base: string): string {
  const c = [base];
  const size = str(e.size).toLowerCase();
  if (size && size !== "default") c.push("sz-" + size);
  if (str(e.weight).toLowerCase() === "bolder") c.push("bold");
  if (str(e.weight).toLowerCase() === "lighter") c.push("light");
  const color = str(e.color).toLowerCase();
  if (color && color !== "default") c.push("c-" + color);
  if (e.isSubtle === true) c.push("subtle");
  if (e.fontType === "Monospace" || e.fontType === "monospace") c.push("mono");
  if (e.wrap !== true && e.type === "TextBlock") c.push("nowrap");
  return c.join(" ");
}

function align(e: Dict): CSSProperties | undefined {
  const a = str(e.horizontalAlignment).toLowerCase();
  return a === "center" || a === "right" ? { textAlign: a } : undefined;
}

// Small icons and avatars from third-party hosts are dropped (not worth a
// "load image" button); larger untrusted images sit behind one.
function shown(e: Dict, size?: string): boolean {
  const src = safeImgSrc(str(e.url));
  if (!src) return false;
  if (isTrustedImgHost(src)) return true;
  const w = px(e.width) || SIZES[(size || str(e.size)).toLowerCase()] || 0;
  return str(e.style).toLowerCase() !== "person" && !(w && w <= 48);
}

function Img({ e, size }: { e: Dict; size?: string }): JSX.Element | null {
  const src = safeImgSrc(str(e.url));
  const alt = str(e.altText);
  const person = str(e.style).toLowerCase() === "person";
  const s = (size || str(e.size)).toLowerCase();
  const dim = SIZES[s] || 0;
  const w = px(e.width) || dim;
  const h = px(e.height) || (person ? w : 0);
  const style: CSSProperties = {};
  if (w) style.width = w;
  if (h) style.height = h;
  const cls = "tc-ac-img" + (person ? " person" : "") + (s === "stretch" ? " stretch" : "");
  if (!shown(e, size)) return null;
  if (!isTrustedImgHost(src)) return <GatedImg src={src} alt={alt} />;
  return <img className={cls} src={src} alt={alt} style={style} loading="lazy" />;
}

function Columns({ e, ctx }: { e: Dict; ctx: Ctx }): JSX.Element {
  return (
    <div className="tc-ac-cols">
      {list(e.columns).map((col, i) => {
        if (col.isVisible === false && !ctx.hidden[str(col.id)]) return null;
        const w = col.width;
        const style: CSSProperties =
          w === "auto"
            ? { flex: "0 0 auto" }
            : typeof w === "number"
              ? { flex: `${w} 1 0` }
              : px(w)
                ? { flex: `0 0 ${px(w)}px` }
                : /^\d+$/.test(str(w))
                  ? { flex: `${str(w)} 1 0` }
                  : { flex: "1 1 0" };
        const v = str(col.verticalContentAlignment).toLowerCase();
        if (v === "center") style.alignSelf = "center";
        if (v === "bottom") style.alignSelf = "flex-end";
        return (
          <div key={i} className={"tc-ac-col" + boxCls(col)} style={style}>
            <Items items={col.items} ctx={ctx} />
          </div>
        );
      })}
    </div>
  );
}

function boxCls(e: Dict): string {
  const s = str(e.style).toLowerCase();
  return s && s !== "default" ? " box " + s : "";
}

function Facts({ e }: { e: Dict }): JSX.Element {
  return (
    <dl className="tc-ac-facts">
      {list(e.facts).map((f, i) => (
        <Fragment key={i}>
          <dt>
            <Md text={str(f.title)} />
          </dt>
          <dd>
            <Md text={str(f.value)} />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Table({ e, ctx }: { e: Dict; ctx: Ctx }): JSX.Element {
  const cols = list(e.columns).length || Math.max(0, ...list(e.rows).map((r) => list(r.cells).length));
  const header = e.firstRowAsHeader !== false;
  return (
    <div className="tc-ac-table" style={{ gridTemplateColumns: `repeat(${cols || 1}, auto)` }}>
      {list(e.rows).map((r, ri) =>
        list(r.cells).map((c, ci) => (
          <div key={ri + "-" + ci} className={"tc-ac-cell" + (header && ri === 0 ? " head" : "")}>
            <Items items={c.items} ctx={ctx} />
          </div>
        )),
      )}
    </div>
  );
}

function Rich({ e }: { e: Dict }): JSX.Element {
  return (
    <p className="tc-ac-text" style={align(e)}>
      {(Array.isArray(e.inlines) ? e.inlines : []).map((r: unknown, i) => {
        if (typeof r === "string") return r;
        if (!isDict(r)) return null;
        const c = [textCls(r, "")];
        if (r.italic === true) c.push("italic");
        if (r.strikethrough === true) c.push("strike");
        if (r.underline === true) c.push("underline");
        if (r.highlight === true) c.push("mark");
        const text = decode(expandDates(str(r.text)));
        const href = isDict(r.selectAction) ? safeHref(str(r.selectAction.url)) : "";
        return href ? (
          <a key={i} className={c.join(" ").trim()} href={href} target="_blank" rel="noreferrer noopener">
            {text}
          </a>
        ) : (
          <span key={i} className={c.join(" ").trim()}>
            {text}
          </span>
        );
      })}
    </p>
  );
}

function Element({ e, ctx }: { e: Dict; ctx: Ctx }): JSX.Element | null {
  const id = str(e.id);
  const visible = id && id in ctx.hidden ? !ctx.hidden[id] : e.isVisible !== false;
  if (!visible) return null;
  let node: JSX.Element | null;
  switch (e.type) {
    case "TextBlock":
      node = (
        <div className={textCls(e, "tc-ac-text")} style={align(e)}>
          <Md text={str(e.text)} />
        </div>
      );
      break;
    case "RichTextBlock":
      node = <Rich e={e} />;
      break;
    case "Container":
      node = (
        <div className={"tc-ac-box" + boxCls(e)}>
          <Items items={e.items} ctx={ctx} />
        </div>
      );
      break;
    case "ColumnSet":
      node = <Columns e={e} ctx={ctx} />;
      break;
    case "Image":
      node = !shown(e) ? null : (
        <div className="tc-ac-imgwrap" style={align(e)}>
          <Img e={e} />
        </div>
      );
      break;
    case "ImageSet":
      node = (
        <div className="tc-ac-imgset">
          {list(e.images).map((im, i) => (
            <Img key={i} e={im} size={str(e.imageSize) || "medium"} />
          ))}
        </div>
      );
      break;
    case "FactSet":
      node = <Facts e={e} />;
      break;
    case "Table":
      node = <Table e={e} ctx={ctx} />;
      break;
    case "ActionSet":
      node = <Actions actions={e.actions} ctx={ctx} />;
      break;
    default:
      // Inputs, media, unknown types: their fallback element, else nothing
      // (inputs only work inside Teams; the card's Submit button says so).
      node = isDict(e.fallback) ? <Element e={e.fallback} ctx={ctx} /> : null;
  }
  if (!node) return null;
  const spacing = str(e.spacing).toLowerCase();
  const cls = "tc-ac-el" + (e.separator === true ? " sep" : "") + (spacing ? " sp-" + spacing : "");
  return <div className={cls}>{node}</div>;
}

function Items({ items, ctx }: { items: unknown; ctx: Ctx }): JSX.Element {
  return (
    <>
      {list(items).map((e, i) => (
        <Element key={i} e={e} ctx={ctx} />
      ))}
    </>
  );
}

// --- Actions -----------------------------------------------------------------

function Actions({ actions, ctx }: { actions: unknown; ctx: Ctx }): JSX.Element | null {
  const [shown, setShown] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const all = list(actions);
  if (!all.length) return null;
  const primary = all.filter((a) => str(a.mode).toLowerCase() !== "secondary");
  const secondary = all.filter((a) => str(a.mode).toLowerCase() === "secondary");
  const visible = more ? all : primary;
  const sub = shown !== null && isDict(all[shown]?.card) ? (all[shown].card as Dict) : null;
  const button = (a: Dict): JSX.Element => {
    const i = all.indexOf(a);
    const title = str(a.title) || str(a.tooltip);
    const style = str(a.style).toLowerCase();
    const cls = "tc-ac-btn" + (style === "positive" ? " positive" : style === "destructive" ? " destructive" : "");
    const icon =
      a.iconUrl && isTrustedImgHost(safeImgSrc(str(a.iconUrl))) ? (
        <img className="tc-ac-btn-icon" src={safeImgSrc(str(a.iconUrl))} alt="" />
      ) : null;
    const label = title || (icon ? null : "…");
    if (a.type === "Action.OpenUrl") {
      const href = safeHref(str(a.url));
      if (href)
        return (
          <a key={i} className={cls} href={href} target="_blank" rel="noreferrer noopener" title={href}>
            {icon}
            {label}
            <ExternalLink size={12} aria-hidden />
          </a>
        );
    }
    if (a.type === "Action.ShowCard")
      return (
        <button
          key={i}
          type="button"
          className={cls + (shown === i ? " on" : "")}
          aria-expanded={shown === i}
          onClick={() => setShown(shown === i ? null : i)}
        >
          {icon}
          {label}
        </button>
      );
    if (a.type === "Action.ToggleVisibility")
      return (
        <button
          key={i}
          type="button"
          className={cls}
          onClick={() =>
            ctx.toggle(
              (Array.isArray(a.targetElements) ? a.targetElements : [])
                .map((x: unknown) => (typeof x === "string" ? x : isDict(x) ? str(x.elementId) : ""))
                .filter(Boolean),
            )
          }
        >
          {icon}
          {label}
        </button>
      );
    // Submit / Execute / anything else needs Teams' bot invoke.
    return (
      <button
        key={i}
        type="button"
        className={cls}
        title={t().chat.cardActionInTeams}
        disabled={!ctx.openInTeams}
        onClick={ctx.openInTeams}
      >
        {icon}
        {label}
      </button>
    );
  };
  return (
    <>
      <div className="tc-ac-actions">
        {visible.map(button)}
        {secondary.length && !more ? (
          <button type="button" className="tc-ac-btn" title={t().chat.cardMoreActions} onClick={() => setMore(true)}>
            <MoreHorizontal size={14} />
          </button>
        ) : null}
      </div>
      {sub ? (
        <div className="tc-ac-sub">
          <Body card={sub} ctx={ctx} />
        </div>
      ) : null}
    </>
  );
}

function Body({ card, ctx }: { card: Dict; ctx: Ctx }): JSX.Element {
  return (
    <>
      <Items items={card.body} ctx={ctx} />
      <Actions actions={card.actions} ctx={ctx} />
    </>
  );
}

// --- Hero / thumbnail / O365 connector cards -> Adaptive elements ------------

function button(b: Dict): Dict {
  const url = str(b.value) || str(b.url);
  return /^(openUrl|signin|downloadFile|playAudio|playVideo|showImage)$/i.test(str(b.type)) && url
    ? { type: "Action.OpenUrl", title: str(b.title), url }
    : { type: "Action.Submit", title: str(b.title) };
}

function fromHero(c: Dict): Dict {
  const body: Dict[] = [];
  const imgs = list(c.images).map((i) => ({ type: "Image", url: str(i.url), altText: str(i.alt), size: "stretch" }));
  if (imgs.length) body.push(imgs[0]);
  if (c.title) body.push({ type: "TextBlock", text: str(c.title), weight: "bolder", size: "medium", wrap: true });
  if (c.subtitle) body.push({ type: "TextBlock", text: str(c.subtitle), isSubtle: true, wrap: true });
  if (c.text) body.push({ type: "TextBlock", text: str(c.text), wrap: true });
  return { body, actions: list(c.buttons).map(button) };
}

function fromConnector(c: Dict): Dict {
  const body: Dict[] = [];
  if (c.title) body.push({ type: "TextBlock", text: str(c.title), weight: "bolder", size: "medium", wrap: true });
  if (c.text) body.push({ type: "TextBlock", text: str(c.text), wrap: true });
  for (const s of list(c.sections)) {
    const head: Dict[] = [];
    if (s.activityTitle) head.push({ type: "TextBlock", text: str(s.activityTitle), weight: "bolder", wrap: true });
    if (s.activitySubtitle) head.push({ type: "TextBlock", text: str(s.activitySubtitle), isSubtle: true, wrap: true });
    if (s.activityText) head.push({ type: "TextBlock", text: str(s.activityText), wrap: true });
    if (head.length)
      body.push(
        s.activityImage
          ? {
              type: "ColumnSet",
              columns: [
                {
                  width: "auto",
                  items: [{ type: "Image", url: str(s.activityImage), style: "person", size: "small" }],
                },
                { width: "stretch", items: head },
              ],
            }
          : { type: "Container", items: head },
      );
    if (s.title) body.push({ type: "TextBlock", text: str(s.title), weight: "bolder", wrap: true });
    if (s.text) body.push({ type: "TextBlock", text: str(s.text), wrap: true });
    const facts = list(s.facts).map((f) => ({ title: str(f.name), value: str(f.value) }));
    if (facts.length) body.push({ type: "FactSet", facts });
  }
  const actions = list(c.potentialAction).map((a) => {
    const target = list(a.targets)[0];
    const url = str(target?.uri) || (Array.isArray(a.target) ? str(a.target[0]) : "");
    return a["@type"] === "OpenUri" || a["@type"] === "ViewAction"
      ? { type: "Action.OpenUrl", title: str(a.name), url }
      : { type: "Action.Submit", title: str(a.name) };
  });
  return { body, actions };
}

/** The card as Adaptive-shaped {body, actions}, or null when its type is unknown. */
export function toAdaptive(card: Card): Dict | null {
  const c = card.content;
  const ct = card.contentType.toLowerCase();
  if (c.type === "AdaptiveCard" || Array.isArray(c.body) || ct.endsWith(".adaptive")) return c;
  if (ct.includes("o365connector") || c["@type"] === "MessageCard" || Array.isArray(c.sections))
    return fromConnector(c);
  if (ct.endsWith(".hero") || ct.endsWith(".thumbnail") || c.title || c.text || c.buttons) return fromHero(c);
  return null;
}

function OneCard({ card, openInTeams }: { card: Card; openInTeams?: () => void }): JSX.Element | null {
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const ac = toAdaptive(card);
  if (!ac) return null;
  const ctx: Ctx = {
    hidden,
    openInTeams,
    toggle: (ids) =>
      setHidden((h) => {
        const next = { ...h };
        for (const id of ids) next[id] = !(id in h ? h[id] : isHiddenByDefault(ac, id));
        return next;
      }),
  };
  return (
    <div className="tc-ac">
      <Body card={ac} ctx={ctx} />
    </div>
  );
}

// Initial isVisible of the element with this id, searched through the card.
function isHiddenByDefault(node: unknown, id: string): boolean {
  if (Array.isArray(node)) return node.some((n) => isHiddenByDefault(n, id));
  if (!isDict(node)) return false;
  if (node.id === id) return node.isVisible === false;
  return ["body", "items", "columns", "rows", "cells"].some((k) => isHiddenByDefault(node[k], id));
}

export function Cards({ cards, openInTeams }: { cards: readonly Card[]; openInTeams?: () => void }): JSX.Element {
  return (
    <div className="tc-cards">
      {cards.map((c, i) => (
        <OneCard key={i} card={c} openInTeams={openInTeams} />
      ))}
    </div>
  );
}
