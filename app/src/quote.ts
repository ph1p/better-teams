import type { Quote } from "./types";

const esc2 = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildQuoteHtml(quote: Quote | null) {
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

// The leading Skype Reply blockquote is kept verbatim so an edit can preserve it.
export function splitQuote(content: string) {
  const m = /^\s*(<blockquote[^>]*itemtype="http:\/\/schema\.skype\.com\/Reply"[\s\S]*?<\/blockquote>)\s*/i.exec(
    content || "",
  );
  if (!m) return { quoteHtml: "", body: content || "" };
  return { quoteHtml: m[1], body: (content || "").slice(m[0].length) };
}

// Forwarder's comment sits outside the Skype Forward blockquote, the original
// inside. Greedy to the last </blockquote> so a quote nested in the original
// stays inside.
export function splitForward(content: string) {
  const m = /<blockquote[^>]*itemtype="http:\/\/schema\.skype\.com\/Forward"[^>]*>([\s\S]*)<\/blockquote>/i.exec(
    content || "",
  );
  if (!m) return null;
  const comment = (content.slice(0, m.index) + content.slice(m.index + m[0].length)).trim();
  return { comment, body: m[1] };
}
