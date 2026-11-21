// Teams message content is an HTML string. A strict Trusted Types CSP forbids
// every html-string -> DOM sink (innerHTML, DOMParser, srcdoc, …), so we cannot
// hand the markup to the browser's parser. Instead we tokenize the HTML with
// string ops only and emit React ELEMENTS, which React creates via
// document.createElement — not a Trusted Types sink, so always allowed.
//
// This keeps the rich structure Teams emits — inline images (asyncgw, served
// with the page's own cookies), @mentions, links, lists, bold/italic, inline
// code, code blocks and quoted replies — instead of flattening to plain text.
import { Fragment, useEffect, useState, type ReactNode, type JSX } from "react";
import { highlightLines, onHighlighterReady, normLang } from "./highlight";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  times: "×",
  copy: "©",
  reg: "®",
};
export function decodeEntities(s: string): string {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => (n in ENTITIES ? ENTITIES[n] : m));
}

type Attrs = Record<string, string>;
// Parsed node: either a text string or an element with children.
export interface ElNode {
  tag: string;
  attrs: Attrs;
  children: Node[];
}
export type Node = string | ElNode;

// Which React tag + className we render an HTML tag as.
// null tag = render children only (drop the wrapper).
type TagMap = [tag: keyof JSX.IntrinsicElements | null, cls: string | null];

// Map an opening HTML tag to the React tag + className we render it as.
function mapTag(name: string, attrs: Attrs): TagMap {
  switch (name) {
    case "p":
      return ["p", null];
    case "div":
      return ["div", null];
    case "br":
      return ["br", null];
    case "ul":
      return ["ul", "tc-ul"];
    case "ol":
      return ["ol", "tc-ol"];
    case "li":
      return ["li", null];
    case "b":
    case "strong":
      return ["strong", null];
    case "i":
    case "em":
      return ["em", null];
    case "u":
      return ["u", null];
    case "s":
    case "strike":
    case "del":
      return ["s", null];
    case "code":
      return ["code", "tc-code"];
    case "pre":
      return ["pre", "tc-pre"];
    case "blockquote":
    case "quote":
      return ["blockquote", "tc-quote"];
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return ["div", "tc-h"];
    case "span":
      // @mention spans get a pill; everything else is a transparent wrapper.
      return /Mention/i.test(attrs.itemtype || "") ? ["span", "tc-mention"] : [null, null];
    case "a":
      return ["a", null];
    case "img":
      return ["img", null];
    default:
      return [null, null]; // unknown wrapper: keep its text children
  }
}

const VOID = new Set(["br", "img", "hr"]);
// Elements whose inner content is noise in a chat bubble (scripts, styles, and
// Teams' hidden editor scaffolding).
const DROP = /^(script|style)$/i;

const attrRe = /([a-z0-9:_-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/gi;
function parseAttrs(s: string): Attrs {
  const out: Attrs = {};
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
  return out;
}

const tokenRe = /<\/?([a-z][a-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>/gi;

// Parse an HTML fragment into a tree of {tag, attrs, children} / strings.
export function parse(html: string): ElNode {
  const root: ElNode = { tag: "#root", attrs: {}, children: [] };
  const stack: ElNode[] = [root];
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (node: Node): void => {
    stack[stack.length - 1].children.push(node);
  };
  const text = (raw: string): void => {
    if (!raw) return;
    const t = decodeEntities(raw);
    if (t) push(t);
  };
  while ((m = tokenRe.exec(html))) {
    text(html.slice(last, m.index));
    last = tokenRe.lastIndex;
    const closing = m[0][1] === "/";
    const name = m[1].toLowerCase();
    if (closing) {
      // Pop to the matching open tag if there is one.
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs = parseAttrs(m[2] || "");
    const node: ElNode = { tag: name, attrs, children: [] };
    const selfClose = VOID.has(name) || /\/>$/.test(m[0]);
    if (DROP.test(name)) {
      // Skip the element and, for non-void, its contents until the close tag.
      if (!selfClose) {
        const close = new RegExp("</" + name + "\\s*>", "i");
        close.lastIndex = last;
        const c = html.slice(last).search(close);
        if (c >= 0) {
          last += c + name.length + 3;
          tokenRe.lastIndex = last;
        }
      }
      continue;
    }
    push(node);
    if (!selfClose) stack.push(node);
  }
  text(html.slice(last));
  return root;
}

// Teams' AMS/preview image src already points at de-prod.asyncgw.* /views/imgo,
// which 200s with the page's cookies, so we keep it as-is.
function imgSrc(attrs: Attrs): string {
  return attrs.src || "";
}

const isBr = (n: Node | undefined): n is ElNode => !!n && typeof n === "object" && n.tag === "br";
const isBlank = (n: Node | undefined): boolean => typeof n === "string" && !n.trim();
// Block-ish tags that already introduce their own vertical spacing, so a <br>
// right inside them (or an empty one) is just dead air.
const BLOCK = new Set(["p", "div", "li", "blockquote", "quote", "ul", "ol", "pre", "h1", "h2", "h3", "h4", "h5", "h6"]);

// Teams wraps quoted replies in stacked <div>/<p> with trailing <br>s, which
// render as large empty gaps. Prune the tree: collapse runs of <br> to one,
// drop <br> at the start/end of a block, and drop blocks left empty.
function prune(node: Node): Node | null {
  if (typeof node === "string") return node;
  // Code blocks are whitespace-exact: the blank text after each <br> is the
  // next line's indentation, and <br> runs are blank lines. Leave them alone.
  if (node.tag === "pre") return textOf(node).trim() ? node : null;
  const kids = node.children.map(prune).filter((k): k is Node => k !== null);
  // Collapse consecutive <br> and blank text between them to a single <br>.
  const out: Node[] = [];
  for (const k of kids) {
    const prev = out[out.length - 1];
    if (isBr(k) && (isBr(prev) || prev === undefined)) continue; // run or leading
    if (isBlank(k) && (isBr(prev) || prev === undefined)) continue;
    out.push(k);
  }
  // Trim trailing <br>/blank.
  while (out.length && (isBr(out[out.length - 1]) || isBlank(out[out.length - 1]))) out.pop();
  node.children = out;
  // Drop a block element that ended up with no visible content.
  if (BLOCK.has(node.tag) && node.tag !== "#root") {
    const hasContent = out.some((k) => (typeof k === "string" ? k.trim() : true));
    if (!hasContent) return null;
  }
  return node;
}

// Flatten a parsed node to its raw text (code blocks need the source string).
export function textOf(node: Node): string {
  if (typeof node === "string") return node;
  if (node.tag === "br") return "\n";
  return node.children.map(textOf).join("");
}

// Pull a language hint off a <pre>/<code> class (`language-js`, `lang-ts`) or a
// Teams `data-*` attribute; "" when none is recognised.
function langHint(node: Node): string {
  const probe = (n: Node): string => {
    if (typeof n === "string") return "";
    const a = n.attrs || {};
    const cls = a.class || a.classname || "";
    const m = /(?:language|lang|brush)[-:](\w+)/i.exec(cls);
    if (m && normLang(m[1])) return normLang(m[1]);
    const dl = a["data-lang"] || a["data-language"] || "";
    if (dl && normLang(dl)) return normLang(dl);
    for (const c of n.children || []) {
      const r = probe(c);
      if (r) return r;
    }
    return "";
  };
  return probe(node);
}

// A fenced code block highlighted by Shiki. Falls back to plain text until the
// highlighter has loaded (or forever, if the language is unknown), and
// re-renders when it becomes ready. No innerHTML: tokens become React spans.
function CodeBlock({ code, lang }: { code: string; lang: string }): JSX.Element {
  const [, bump] = useState(0);
  useEffect(() => onHighlighterReady(() => bump((n) => n + 1)), []);
  const lines = lang ? highlightLines(code, lang) : null;
  if (!lines) {
    return (
      <pre className="tc-pre">
        <code className="tc-code">{code}</code>
      </pre>
    );
  }
  return (
    <pre className="tc-pre tc-shiki" data-lang={lang}>
      <code className="tc-code">
        {lines.map((line, i) => (
          <span key={i} className="tc-code-line">
            {line.map((t, j) => (
              <span key={j} style={t.color ? { color: t.color } : undefined}>
                {t.content}
              </span>
            ))}
            {"\n"}
          </span>
        ))}
      </code>
    </pre>
  );
}

let keySeq = 0;
function toReact(node: Node): ReactNode {
  if (typeof node === "string") return node;
  const [tag, cls] = mapTag(node.tag, node.attrs);
  const key = "n" + keySeq++;

  if (node.tag === "pre") {
    // Teams opens code blocks with a <br> and pads with NBSPs; grammars expect
    // plain spaces, and the leading newline would render as an empty line.
    const code = textOf(node)
      .replace(/ /g, " ")
      .replace(/^\n+|\n+$/g, "");
    return <CodeBlock key={key} code={code} lang={langHint(node)} />;
  }

  const kids = node.children.map(toReact).filter((k) => k !== null && k !== "");

  if (node.tag === "img") {
    const alt = node.attrs.alt || "";
    const src = imgSrc(node.attrs);
    // Teams emoji are tiny <img alt="😀">: render the glyph, not a picture.
    const emojiish = (node.attrs.itemtype || "").includes("Emoji") || (!src && alt);
    if (emojiish) return alt || null;
    if (!src) return alt || null;
    return <img key={key} className="tc-inline-img" src={src} alt={alt} loading="lazy" />;
  }
  if (node.tag === "a") {
    const href = decodeEntities(node.attrs.href || "");
    if (!href) return <Fragment key={key}>{kids}</Fragment>;
    return (
      <a key={key} href={href} target="_blank" rel="noreferrer noopener">
        {kids.length ? kids : href}
      </a>
    );
  }
  if (node.tag === "br") return <br key={key} />;

  if (tag === null) {
    // Transparent wrapper: emit children directly.
    return kids.length ? <Fragment key={key}>{kids}</Fragment> : null;
  }
  const T = tag;
  const props: { className?: string; "data-reply-id"?: string } = {};
  if (cls) props.className = cls;
  // Quoted reply: Teams marks it itemtype=".../Reply" itemid=<message id>.
  // Keep the id (the click jumps to the original) and style it apart.
  if (tag === "blockquote" && /schema\.skype\.com\/Reply/i.test(node.attrs.itemtype || "")) {
    props.className = "tc-quote tc-reply";
    if (node.attrs.itemid) props["data-reply-id"] = node.attrs.itemid;
  }
  return (
    <T key={key} {...props}>
      {kids}
    </T>
  );
}

// Render a Teams HTML content string as safe React nodes.
export function RichHtml({ html }: { html: string }): JSX.Element | null {
  if (!html) return null;
  keySeq = 0;
  const tree = prune(parse(String(html)));
  if (!tree || typeof tree === "string") return null;
  return <>{tree.children.map(toReact)}</>;
}
