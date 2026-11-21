// Message HTML → the composer's markdown-lite (see src/markdown.ts), so an
// edit starts from text that formats back to the same message. Covers what
// formatMessage emits plus Teams' own variants (<b>, <em>, <div>, tables as
// plain lines). Unknown wrappers keep their text.

import { decodeEntities, parse, textOf, type ElNode, type Node } from "../../richText";

const isEl = (n: Node | undefined): n is ElNode => !!n && typeof n !== "string";

function lang(pre: ElNode): string {
  const probe = (n: Node): string => {
    if (!isEl(n)) return "";
    const m = /language-([\w#+.-]+)/i.exec(n.attrs.class || "");
    if (m) return m[1].toLowerCase() === "plaintext" ? "" : m[1];
    for (const c of n.children) {
      const r = probe(c);
      if (r) return r;
    }
    return "";
  };
  return probe(pre);
}

function inline(nodes: Node[]): string {
  return nodes.map(inlineOne).join("");
}

function wrap(mark: string, inner: string): string {
  // Markers must hug the text: move edge whitespace outside them.
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
}

function inlineOne(n: Node): string {
  if (!isEl(n)) return n.replace(/ /g, " ");
  switch (n.tag) {
    case "br":
      return "\n";
    case "b":
    case "strong":
      return wrap("**", inline(n.children));
    case "i":
    case "em":
      return wrap("*", inline(n.children));
    case "s":
    case "strike":
    case "del":
      return wrap("~~", inline(n.children));
    case "code":
      return "`" + textOf(n) + "`";
    case "img":
      return n.attrs.alt || "";
    case "a": {
      const href = decodeEntities(n.attrs.href || "");
      const text = inline(n.children).trim();
      if (!href || !/^https?:/i.test(href) || !text || text === href) return text || href;
      return `[${text}](${href})`;
    }
    default:
      return inline(n.children);
  }
}

function block(n: Node, out: string[]): void {
  if (!isEl(n)) {
    const t = n.replace(/ /g, " ");
    if (t.trim()) out.push(t.trim());
    return;
  }
  switch (n.tag) {
    case "pre": {
      const code = textOf(n)
        .replace(/ /g, " ")
        .replace(/^\n+|\n+$/g, "");
      out.push("```" + lang(n) + "\n" + code + "\n```");
      return;
    }
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      out.push("#".repeat(Math.min(3, +n.tag[1])) + " " + inline(n.children).trim());
      return;
    case "ul":
    case "ol": {
      let i = 0;
      const items = n.children
        .filter((c) => isEl(c) && c.tag === "li")
        .map(
          (li) =>
            (n.tag === "ol" ? `${++i}. ` : "- ") +
            inline((li as ElNode).children)
              .trim()
              .replace(/\n+/g, " "),
        );
      if (items.length) out.push(items.join("\n"));
      return;
    }
    case "blockquote": {
      const inner: string[] = [];
      n.children.forEach((c) => block(c, inner));
      const body = inner.join("\n\n");
      if (body)
        out.push(
          body
            .split("\n")
            .map((l) => "> " + l)
            .join("\n"),
        );
      return;
    }
    case "p":
    case "div":
    case "tr":
    case "li":
    case "table":
    case "tbody":
    case "#root": {
      // A block may hold further blocks (div > p) or just inline content.
      const hasBlock = n.children.some((c) => isEl(c) && BLOCKS.has(c.tag));
      if (hasBlock) {
        let run: Node[] = [];
        const flushRun = (): void => {
          const t = inline(run).trim();
          if (t) out.push(t);
          run = [];
        };
        for (const c of n.children) {
          if (isEl(c) && BLOCKS.has(c.tag)) {
            flushRun();
            block(c, out);
          } else run.push(c);
        }
        flushRun();
      } else {
        const t = inline(n.children)
          .replace(/[ \t]+\n/g, "\n")
          .trim();
        if (t) out.push(t);
      }
      return;
    }
    default: {
      const t = inlineOne(n).trim();
      if (t) out.push(t);
    }
  }
}

const BLOCKS = new Set([
  "p",
  "div",
  "pre",
  "ul",
  "ol",
  "blockquote",
  "table",
  "tbody",
  "tr",
  "td",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  const root = parse(html);
  // Drop the CodeBlockEditor marker paragraph that precedes each <pre>.
  root.children = root.children.filter((c) => !(isEl(c) && /CodeBlockEditor/i.test(c.attrs.itemtype || "")));
  const out: string[] = [];
  block(root, out);
  return out
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
