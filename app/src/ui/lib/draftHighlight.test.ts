import { describe, expect, it } from "vitest";
import { highlightDraft, mentionRe, type Seg } from "./draftHighlight";

const text = (segs: Seg[]): string => segs.map((s) => (typeof s === "string" ? s : text(s.kids))).join("");
const html = (segs: Seg[]): string =>
  segs.map((s) => (typeof s === "string" ? s : `<${s.cls}>${html(s.kids)}</>`)).join("");

describe("highlightDraft", () => {
  it("keeps the text unchanged, so the caret lines up", () => {
    const src = "a `b` **c** ~~d~~ *e* _f_ <g> & @Maya Chen\n```ts\nx < 1\n```\n";
    expect(text(highlightDraft(src, mentionRe(["Maya Chen"])))).toBe(src + "​");
  });
  it("marks inline code, bold and mentions", () => {
    const out = html(highlightDraft("run `pnpm i` **now** @Maya Chen", mentionRe(["Maya Chen"])));
    expect(out).toContain("<tc-hl-code><tc-hl-mark>`</>pnpm i");
    expect(out).toContain("<tc-hl-b><tc-hl-mark>**</>now");
    expect(out).toContain("<tc-hl-at>@Maya Chen</>");
  });
  it("leaves markup inside fences alone", () => {
    const out = html(highlightDraft("```\n**x**\n```\n**y**"));
    expect(out).toContain("<tc-hl-pre>**x**</>");
    expect(out).toContain("<tc-hl-b>");
  });
  it("wraps a fence in one block, the next line break inside it", () => {
    const out = html(highlightDraft("a\n```\nx\n```\nb"));
    expect(out).toBe("a\n<tc-hl-block><tc-hl-fence>```</>\n<tc-hl-pre>x</>\n<tc-hl-fence>```</>\n</>b\u200b");
  });
  it("colors fenced code with the given tokens", () => {
    const segs = highlightDraft("```ts\nlet x\n```", null, (code, lang) =>
      code === "let x" && lang === "ts" ? [[{ content: "let", color: "#f00" }, { content: " x" }]] : null,
    );
    expect(JSON.stringify(segs)).toContain('{"cls":"","kids":["let"],"color":"#f00"}');
    expect(text(segs)).toBe("```ts\nlet x\n```\u200b");
  });
});
