// Native Teams quote-reply markup: build the Skype Reply blockquote for an
// outgoing reply, and split it back off a stored message for editing. Pure
// string helpers, shared by the live data layer and the mock.
import type { Quote } from "./types";

// HTML-escape text for element content (used in quote preview/sender name).
const esc2 = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Build the native Skype Reply blockquote for a quote-reply. `quote` is
// { id, from, text, fromMri }; returns "" when there is nothing to quote.
export function buildQuoteHtml(quote: Quote | null): string {
  if (!quote || !quote.id) return "";
  const qid = String(quote.id).replace(/"/g, "&quot;");
  const qmri = String(quote.fromMri || "").replace(/"/g, "&quot;");
  const qfrom = esc2(quote.from || "");
  const qprev = esc2(String(quote.text || "").slice(0, 1000));
  return (
    `<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="${qid}">\r\n` +
    `<strong itemprop="mri" itemid="${qmri}">${qfrom}</strong>` +
    `<span itemprop="time" itemid="${qid}"></span>\r\n` +
    `<p itemprop="preview">${qprev}</p>\r\n` +
    `</blockquote>\r\n`
  );
}

// Split a message's stored HTML into { quoteHtml, body }: the leading Skype
// Reply blockquote (kept verbatim so an edit can preserve it) and the rest.
// No quote → { quoteHtml: "", body: content }.
export function splitQuote(content: string): { quoteHtml: string; body: string } {
  const m = /^\s*(<blockquote[^>]*itemtype="http:\/\/schema\.skype\.com\/Reply"[\s\S]*?<\/blockquote>)\s*/i.exec(
    content || "",
  );
  if (!m) return { quoteHtml: "", body: content || "" };
  return { quoteHtml: m[1], body: (content || "").slice(m[0].length) };
}

// Split a forwarded message into the forwarder's comment (outside the block)
// and the original body (inside the Skype Forward blockquote). Greedy to the
// last </blockquote> so a quote nested in the original stays inside.
// Not a forward → null.
export function splitForward(content: string): { comment: string; body: string } | null {
  const m = /<blockquote[^>]*itemtype="http:\/\/schema\.skype\.com\/Forward"[^>]*>([\s\S]*)<\/blockquote>/i.exec(
    content || "",
  );
  if (!m) return null;
  const comment = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
  return { comment, body: m[1] };
}
