// Markdown-lite for the composer: turns the plain draft into the HTML the
// native Teams composer would send, so recipients see real formatting.
//
// Blocks:  ```lang fenced code```, # / ## / ### headings, - * + bullet lists,
//          1. numbered lists, > quotes, blank line = new paragraph,
//          single newline = line break.
// Inline:  `code`, **bold**, *italic* / _italic_, ~~strike~~,
//          [text](https://…) and bare https:// links.
//
// Native shapes (verified from Teams' IndexedDB, Nov 2026):
//   code block  <p itemtype="http://schema.skype.com/CodeBlockEditor" id="codeBlockEditor-<uuid>">&nbsp;</p>
//               <pre class="language-ts" itemid="codeBlockEditor-<uuid>"><code>line<br />line</code></pre>
//   link        <a href="URL" rel="noreferrer noopener" title="URL" target="_blank">text</a>
//   other       <strong> <i> <s> <code> <ul><li> <ol><li> <blockquote> <h1>-<h3>
//
// Plain text without markup comes out exactly as before: <p>escaped text</p>.

import { claimMentions, escText, mentionEntry, mentionSpan, type MentionContent, type MentionPick } from "./mentions";

// Private-use markers: mentions (M) and finished inline HTML (H) are swapped
// out for these while the text is escaped and scanned for markup.
const M0 = "",
  M1 = "",
  H0 = "",
  H1 = "";
const MENTION_RE = /(\d+)/g;
const STASH_RE = /(\d+)/g;

export const FENCE_OPEN = /^\s*```\s*([\w#+.-]*)\s*$/;
export const FENCE_CLOSE = /^\s*```\s*$/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

const escAttr = (s: string) => escText(s).replace(/"/g, "&quot;");

function uuid() {
  try {
    return crypto.randomUUID();
  } catch {
    return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
  }
}

/** Inside an unclosed ``` fence Enter means newline. */
export function inOpenFence(textBeforeCaret: string) {
  let open = false;
  for (const line of textBeforeCaret.split("\n")) {
    if (open ? FENCE_CLOSE.test(line) : FENCE_OPEN.test(line)) open = !open;
  }
  return open;
}

class Renderer {
  private stash: string[] = [];
  constructor(
    private names: string[],
    private newId: () => string,
  ) {}

  /** Mention markers back to their literal `@Name` (inside code). */
  private literal(s: string) {
    return s.replace(MENTION_RE, (_, i: string) => "@" + this.names[+i]);
  }

  private keep(html: string) {
    return H0 + (this.stash.push(html) - 1) + H1;
  }

  private link(url: string, label: string) {
    const u = escAttr(url);
    return this.keep(`<a href="${u}" rel="noreferrer noopener" title="${u}" target="_blank">${label}</a>`);
  }

  /** One line, or several joined by \n → <br />. */
  inline(src: string) {
    // Code spans first: nothing inside them is markup.
    let s = src.replace(/`([^`\n]+)`/g, (_, code: string) => this.keep(`<code>${escText(this.literal(code))}</code>`));
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) =>
      this.link(url, escText(label)),
    );
    s = s.replace(/\bhttps?:\/\/[^\s<>-]*[^\s<>.,:;"'!?)\]-]/g, (url: string) => this.link(url, escText(url)));
    s = escText(s)
      .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
      .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, "<s>$1</s>")
      .replace(/(^|[^*\w])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![*\w])/g, "$1<i>$2</i>")
      .replace(/(^|[^\w])_(?=\S)([^_\n]+?)(?<=\S)_(?!\w)/g, "$1<i>$2</i>")
      .replace(/\n/g, "<br />");
    // Stashed HTML can nest (a link label never does), one pass is enough.
    return s.replace(STASH_RE, (_, i: string) => this.stash[+i]);
  }

  private code(lines: string[], lang: string) {
    const id = "codeBlockEditor-" + this.newId();
    const body = lines.map((l) => escText(this.literal(l))).join("<br />");
    const cls = "language-" + (lang.toLowerCase() || "plaintext");
    return (
      `<p itemtype="http://schema.skype.com/CodeBlockEditor" id="${id}">&nbsp;</p>` +
      `<pre class="${escAttr(cls)}" itemid="${id}"><code>${body}</code></pre>`
    );
  }

  blocks(lines: string[]): string {
    let html = "";
    let para: string[] = [];
    const flush = () => {
      if (para.length) html += "<p>" + this.inline(para.join("\n")) + "</p>";
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = FENCE_OPEN.exec(line);
      if (fence) {
        flush();
        const code: string[] = [];
        for (i++; i < lines.length && !FENCE_CLOSE.test(lines[i]); i++) code.push(lines[i]);
        // Drop the blank edges people leave inside fences.
        while (code.length && !code[0].trim()) code.shift();
        while (code.length && !code[code.length - 1].trim()) code.pop();
        if (code.length) html += this.code(code, fence[1]);
        continue;
      }
      const h = HEADING.exec(line);
      if (h) {
        flush();
        html += `<h${h[1].length}>${this.inline(h[2])}</h${h[1].length}>`;
        continue;
      }
      const list = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null;
      if (list) {
        flush();
        const tag = list === BULLET ? "ul" : "ol";
        html += `<${tag}>`;
        for (; i < lines.length && list.test(lines[i]); i++)
          html += "<li>" + this.inline(list.exec(lines[i])![1]) + "</li>";
        i--;
        html += `</${tag}>`;
        continue;
      }
      if (QUOTE.test(line)) {
        flush();
        const inner: string[] = [];
        for (; i < lines.length && QUOTE.test(lines[i]); i++) inner.push(QUOTE.exec(lines[i])![1]);
        i--;
        html += "<blockquote>" + this.blocks(inner) + "</blockquote>";
        continue;
      }
      if (!line.trim()) flush();
      else para.push(line);
    }
    flush();
    return html;
  }
}

/**
 * Draft text + @mention picks → message HTML and the properties.mentions JSON.
 * Mentions inside code stay literal text and are not sent as mentions.
 * `newId` names code blocks; pass a stable one to render a preview.
 */
export function formatMessage(
  text: string,
  picks: readonly MentionPick[] = [],
  newId: () => string = uuid,
): MentionContent {
  const body = text.replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
  const spans = claimMentions(body, picks);
  let src = "";
  let cursor = 0;
  spans.forEach((s, i) => {
    src += body.slice(cursor, s.start) + M0 + i + M1;
    cursor = s.end;
  });
  src += body.slice(cursor);

  const raw = new Renderer(
    spans.map((s) => s.pick.name),
    newId,
  ).blocks(src.split("\n"));

  const entries: string[] = [];
  const html = raw.replace(MENTION_RE, (_, i: string) => {
    const idx = entries.length;
    entries.push(mentionEntry(idx, spans[+i].pick));
    return mentionSpan(idx, spans[+i].pick.name);
  });
  return { html: html || "<p></p>", mentions: "[" + entries.join(",") + "]" };
}
