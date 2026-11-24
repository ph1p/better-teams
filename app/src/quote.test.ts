import { describe, expect, it } from "vitest";
import { buildQuoteHtml, splitForward, splitQuote } from "./quote";

const quote = { id: "123", from: "A<b>", text: "t", fromMri: "8:x", time: 0 };

describe("buildQuoteHtml", () => {
  it("builds the Teams reply blockquote", () => {
    expect(buildQuoteHtml(quote)).toBe(
      '<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="123">\r\n<strong itemprop="mri" itemid="8:x">A&lt;b&gt;</strong><span itemprop="time" itemid="123"></span>\r\n<p itemprop="preview">t</p>\r\n</blockquote>\r\n',
    );
  });
});

describe("splitQuote", () => {
  it("round-trips a quote and body", () => {
    const q = buildQuoteHtml(quote);
    expect(splitQuote(q + "<p>body</p>")).toEqual({ quoteHtml: q.replace(/\r\n$/, ""), body: "<p>body</p>" });
  });

  it("returns the body untouched when there is no quote", () => {
    expect(splitQuote("<p>x</p>")).toEqual({ quoteHtml: "", body: "<p>x</p>" });
  });
});

describe("splitForward", () => {
  const fwd = (inner: string): string => `<blockquote itemtype="http://schema.skype.com/Forward">${inner}</blockquote>`;

  it("returns null for a non-forward", () => {
    expect(splitForward("<p>hi</p>")).toBeNull();
  });

  it("splits the comment off the forwarded body", () => {
    expect(splitForward("<p>fyi</p>" + fwd("<p>GitHub Issues sind erstellt</p>"))).toEqual({
      comment: "<p>fyi</p>",
      body: "<p>GitHub Issues sind erstellt</p>",
    });
  });

  it("keeps a quote nested in the original inside the body", () => {
    const inner = '<blockquote itemtype="http://schema.skype.com/Reply" itemid="1"><p>q</p></blockquote><p>a</p>';
    expect(splitForward(fwd(inner))).toEqual({ comment: "", body: inner });
  });
});
