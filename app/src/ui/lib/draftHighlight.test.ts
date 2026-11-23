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
});
