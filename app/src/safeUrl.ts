// URL checks for values that come from message content (other people's HTML
// and file JSON). React 18 still renders `javascript:` hrefs, so anything not
// on these lists is dropped and the caller falls back to plain text.
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function protocolOf(url: string) {
  try {
    return new URL(url).protocol;
  } catch {
    return "";
  }
}

export function safeHref(url: string) {
  return url && LINK_PROTOCOLS.has(protocolOf(url)) ? url : "";
}

export function safeImgSrc(url: string) {
  return url && protocolOf(url) === "https:" ? url : "";
}

// Hosts whose images load without asking: Microsoft's own services, which
// already see that you are online, and Giphy, which Teams' own GIF picker
// uses. Anything else waits for a click.
const TRUSTED_IMG_HOSTS = [
  "teams.microsoft.com",
  "microsoft.com",
  "skype.com",
  "sharepoint.com",
  "office.com",
  "office.net",
  "live.com",
  "giphy.com",
];

export function isTrustedImgHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return TRUSTED_IMG_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const IMG_EXT = /\.(gif|png|jpe?g|webp|avif)$/i;

export function isImageUrl(url: string) {
  if (!safeImgSrc(url)) return false;
  try {
    return IMG_EXT.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
