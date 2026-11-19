// In-page token capture — replaces the external CDP token-bridge.
//
// Teams itself makes its chatsvc calls through the page's window.fetch, carrying
// its ic3 bearer in the Authorization header. We wrap window.fetch once, read
// that bearer off Teams' own outgoing calls (passively — we never block, alter
// or re-send), and park it on window.__tcTok = { ic3, region, at }. teamsData.ts
// reads that global to load uncached chats from the same backend.
//
// The token is Teams' own, held in memory only, never logged or sent anywhere.

const b64url = (s: string): string => {
  try {
    return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return "";
  }
};
const claims = (t: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(b64url(t.split(".")[1] || ""));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const isIc3 = (t: string): boolean => /ic3\.teams\.office\.com/.test(String(claims(t).aud || ""));
// SubstrateSearch audience — the org people-search (suggestions) endpoint wants
// this bearer, which is distinct from the ic3 chatsvc one.
const isSubstrate = (t: string): boolean =>
  /66a88757-258c-4c72-893c-3e8bed4d6899|SubstrateSearch/i.test(
    String(claims(t).aud || "") + " " + String(claims(t).scp || "")
  );

function rememberSub(auth: string): void {
  if (!auth || auth.indexOf("Bearer ") !== 0) return;
  const t = auth.slice(7);
  if (!isSubstrate(t)) return;
  window.__tcSubTok = { tok: t, at: Date.now() };
}

const regionFrom = (url: string): string | null => {
  const m =
    /https:\/\/([a-z]{2,4})-prod\.asyncgw/.exec(url) ||
    /\/api\/chatsvc\/([a-z]{2,4})\//.exec(url);
  return m ? m[1] : null;
};

// Headers may be a Headers object, a plain record, or absent.
type HeaderLike = Headers | Record<string, string> | undefined;

function headerAuth(headers: HeaderLike): string {
  if (!headers) return "";
  try {
    if (typeof (headers as Headers).get === "function") return (headers as Headers).get("authorization") || "";
  } catch {
    /* ignore */
  }
  const rec = headers as Record<string, string>;
  return rec.authorization || rec.Authorization || "";
}

function remember(auth: string, url: string): void {
  if (!auth || auth.indexOf("Bearer ") !== 0) return;
  const t = auth.slice(7);
  if (!isIc3(t)) return;
  const reg = regionFrom(url || "");
  window.__tcTok = { ic3: t, region: reg || (window.__tcTok && window.__tcTok.region) || "de", at: Date.now() };
}

// Some chatsvc traffic goes through XMLHttpRequest, not fetch; read the bearer
// off setRequestHeader too. Own flag so an already-patched page still gets it.
function installXhrCapture(): void {
  if (typeof XMLHttpRequest === "undefined" || window.__tcXhrOn) return;
  const proto = XMLHttpRequest.prototype;
  const urls = new WeakMap<XMLHttpRequest, string>();
  const origOpen = proto.open;
  const origSet = proto.setRequestHeader;
  proto.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
    try { urls.set(this, String(args[1] ?? "")); } catch { /* ignore */ }
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  };
  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string): void {
    try {
      const url = urls.get(this) || "";
      if (/^authorization$/i.test(name)) {
        if (/chatsvc|asyncgw/.test(url)) remember(value, url);
        else if (/substrate\.office\.com/i.test(url)) rememberSub(value);
      }
    } catch {
      /* never let capture break a real request */
    }
    return origSet.call(this, name, value);
  };
  window.__tcXhrOn = true;
}

// Idempotent: a re-injected overlay must not double-wrap fetch.
export function installTokenCapture(): void {
  if (typeof window === "undefined") return;
  installXhrCapture();
  if (window.__tcCapOn) return;
  const of = window.fetch;
  if (typeof of !== "function") return;
  window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    const [input, init] = args;
    try {
      const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String((input as URL) || ""));
      if (/chatsvc|asyncgw/.test(url)) {
        // Header may live on init, or on a Request object passed as input.
        const auth =
          headerAuth(init && (init.headers as HeaderLike)) ||
          headerAuth(input instanceof Request ? input.headers : undefined);
        if (auth) remember(auth, url);
      }
      // Profile photos live on /api/mt/<region>/ (cookie-auth, no bearer) and
      // use a different region than chatsvc. Capture it for photo URLs.
      const mt = /\/api\/mt\/([a-z]{2,4})\//.exec(url);
      if (mt) window.__tcMtRegion = mt[1];
      // Org people-search (suggestions) rides a SubstrateSearch bearer, captured
      // off Teams' own search traffic so searchPeople() can reuse it.
      if (/substrate\.office\.com/i.test(url)) {
        const auth2 =
          headerAuth(init && (init.headers as HeaderLike)) ||
          headerAuth(input instanceof Request ? input.headers : undefined);
        if (auth2) rememberSub(auth2);
      }
    } catch {
      /* never let capture break a real request */
    }
    return of.apply(this as typeof globalThis, args);
  };
  window.__tcCapOn = true;
}
