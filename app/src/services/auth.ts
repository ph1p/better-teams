// Token vault for the service layer.
//
// Teams authenticates every backend call with a bearer for that backend's
// audience (chatsvc = ic3, people search = SubstrateSearch, presence, graph, …).
// We never mint or fetch tokens ourselves. We wrap the page's fetch and
// XMLHttpRequest once and read the Authorization header off Teams' OWN outgoing
// requests — passively: the request is never blocked, altered or re-sent. Each
// bearer is filed under its audience (the JWT `aud` claim), so any service
// module can ask for "the token Teams uses for X".
//
// Tokens live in memory only, in this window. They are never logged, persisted
// or sent anywhere except back to the same Microsoft backend they came from
// (http.ts enforces that with an egress allowlist).
//
// The vault hangs off a Symbol.for key on window so a hot re-injected overlay
// build keeps the tokens the previous build already captured.

export type Audience =
  | "ic3" // chatsvc / asyncgw (messages, conversations, AMS)
  | "substrate" // substrate.office.com (people search, suggestions)
  | "presence" // presence.teams.microsoft.com
  | "graph" // graph.microsoft.com
  | "chatsvcagg" // /api/csa (channel posts, tag cards)
  | "mt" // /api/mt (short profiles, team apps); aud api.spaces.skype.com
  | "other";

interface Entry {
  tok: string;
  exp: number; // epoch ms; 0 = unknown
  at: number; // when we last saw Teams use it
  aud: string; // raw aud claim, for diagnostics
}

interface Vault {
  tokens: Map<Audience, Entry>;
  regions: { chatsvc?: string; mt?: string; ups?: string };
  waiters: Set<() => void>;
  installed: { fetch?: boolean; xhr?: boolean };
}

const KEY = Symbol.for("teams-calm.vault");
type VaultHost = { [KEY]?: Vault };

// The realm this module runs in: `window` in the host/child page, the worker
// global scope inside a web worker. globalThis resolves to whichever applies,
// so the same capture code wraps fetch/XHR wherever it is placed. Each realm
// keeps its own vault; a worker that cannot reach the page vault forwards a
// captured header with ingestAuthHeader (see below).
function g(): VaultHost {
  return globalThis as unknown as VaultHost;
}

function vault(): Vault {
  const host = g();
  let v = host[KEY];
  if (!v) {
    v = { tokens: new Map(), regions: {}, waiters: new Set(), installed: {} };
    Object.defineProperty(host, KEY, { value: v, enumerable: false });
  }
  return v;
}

// --- JWT claims (read only; never verified, never logged) --------------------

function claims(jwt: string): Record<string, unknown> {
  try {
    const part = (jwt.split(".")[1] || "").replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(part));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function classify(aud: string, scp: string): Audience | null {
  if (/ic3(-non-cae)?\.teams\.office\.com/i.test(aud)) return "ic3";
  if (/66a88757-258c-4c72-893c-3e8bed4d6899|substrate\.office\.com/i.test(aud) || /SubstrateSearch/i.test(scp))
    return "substrate";
  if (/presence\.teams\.microsoft\.com/i.test(aud)) return "presence";
  if (/graph\.microsoft\.com|00000003-0000-0000-c000-000000000000/i.test(aud)) return "graph";
  if (/chatsvcagg\.teams\.microsoft\.com/i.test(aud)) return "chatsvcagg";
  if (/api\.spaces\.skype\.com/i.test(aud)) return "mt";
  return null;
}

function remember(authHeader: string, url: string): void {
  if (!authHeader || !/^Bearer /i.test(authHeader)) return;
  const tok = authHeader.slice(7).trim();
  const c = claims(tok);
  const aud = String(c.aud || "");
  const kind = classify(aud, String(c.scp || ""));
  if (!kind) return;
  const v = vault();
  const exp = typeof c.exp === "number" ? c.exp * 1000 : 0;
  const prev = v.tokens.get(kind);
  // Keep the longer-lived one if Teams briefly uses an older token.
  if (prev && prev.tok !== tok && prev.exp > exp && prev.exp - Date.now() > 60_000) return;
  v.tokens.set(kind, { tok, exp, at: Date.now(), aud });
  noteRegion(url);
  for (const w of [...v.waiters]) w();
}

function noteRegion(url: string): void {
  const v = vault();
  const cs = /https:\/\/([a-z]{2,4})-prod\.asyncgw/.exec(url) || /\/api\/chatsvc\/([a-z]{2,4})\//.exec(url);
  if (cs) v.regions.chatsvc = cs[1];
  const mt = /\/api\/mt\/([a-z]{2,4})\//.exec(url);
  if (mt) v.regions.mt = mt[1];
  const ups = /\/ups\/([a-z]{2,4})\/v1\//.exec(url);
  if (ups) v.regions.ups = ups[1];
}

// --- Capture hooks ------------------------------------------------------------

type HeaderLike = Headers | Record<string, string> | [string, string][] | undefined;

function authOf(headers: HeaderLike): string {
  if (!headers) return "";
  try {
    if (headers instanceof Headers) return headers.get("authorization") || "";
    if (Array.isArray(headers)) {
      const hit = headers.find(([k]) => /^authorization$/i.test(k));
      return hit ? hit[1] : "";
    }
    return headers.authorization || headers.Authorization || "";
  } catch {
    return "";
  }
}

function installFetch(): void {
  const v = vault();
  const scope = globalThis as typeof globalThis;
  if (v.installed.fetch || typeof scope.fetch !== "function") return;
  const orig = scope.fetch;
  scope.fetch = function (this: unknown, ...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
    try {
      const [input, init] = args;
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      noteRegion(url);
      const auth =
        authOf(init && (init.headers as HeaderLike)) || (input instanceof Request ? authOf(input.headers) : "");
      if (auth) remember(auth, url);
    } catch {
      /* capture must never break a real request */
    }
    return orig.apply(this as typeof globalThis, args);
  };
  v.installed.fetch = true;
}

function installXhr(): void {
  const v = vault();
  if (v.installed.xhr || typeof XMLHttpRequest === "undefined") return;
  const proto = XMLHttpRequest.prototype;
  const urls = new WeakMap<XMLHttpRequest, string>();
  const origOpen = proto.open;
  const origSet = proto.setRequestHeader;
  proto.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
    try {
      const url = String(args[1] ?? "");
      urls.set(this, url);
      noteRegion(url);
    } catch {
      /* ignore */
    }
    return (origOpen as (...a: unknown[]) => void).apply(this, args);
  };
  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string): void {
    try {
      if (/^authorization$/i.test(name)) remember(value, urls.get(this) || "");
    } catch {
      /* ignore */
    }
    return origSet.call(this, name, value);
  };
  v.installed.xhr = true;
}

/**
 * Idempotent; safe to call from every (re-)injected build and from any realm
 * (page or worker). Teams issues several backend tokens (mt, csa/chatsvcagg,
 * presence) only from its web workers, whose fetch/XHR never cross the page
 * realm — so wrapping here in the page alone cannot see them. Running this same
 * function inside a worker captures them into that worker's vault; to make them
 * usable by page-realm service calls, forward them with ingestAuthHeader.
 */
export function installAuthCapture(): void {
  if (typeof globalThis === "undefined") return;
  installFetch();
  installXhr();
  // Expose the forwarder on the realm global so an out-of-page tap (the CDP
  // worker bridge, which can reach a worker's request headers that in-page
  // wraps cannot) can file a captured bearer into this vault. No-op if unused.
  try {
    (globalThis as unknown as { __tcAuthIngest?: typeof ingestAuthHeader }).__tcAuthIngest = ingestAuthHeader;
  } catch {
    /* read-only global; ignore */
  }
}

/**
 * File an Authorization header captured elsewhere (another realm's worker tap,
 * e.g. the CDP presence bridge) into this realm's vault, exactly as if we had
 * seen Teams use it here. Passive: nothing is sent; `header` is "Bearer <jwt>"
 * read off Teams' own request, `url` its request URL (for region detection).
 * Unknown audiences are ignored. Never throws.
 */
export function ingestAuthHeader(header: string, url = ""): void {
  try {
    remember(header, url);
  } catch {
    /* ignore malformed input */
  }
}

// --- Read side ----------------------------------------------------------------

const SKEW_MS = 60_000;

/** Current bearer for an audience, or "" if none captured / it expired. */
export function token(aud: Audience): string {
  const e = vault().tokens.get(aud);
  if (!e) return "";
  if (e.exp && e.exp - SKEW_MS < Date.now()) return "";
  return e.tok;
}

/** Resolves with a bearer as soon as Teams uses one (or "" after `ms`). */
export function whenToken(aud: Audience, ms = 10_000): Promise<string> {
  const now = token(aud);
  if (now) return Promise.resolve(now);
  const v = vault();
  return new Promise((resolve) => {
    const done = (t: string): void => {
      v.waiters.delete(check);
      clearTimeout(timer);
      resolve(t);
    };
    const check = (): void => {
      const t = token(aud);
      if (t) done(t);
    };
    const timer = setTimeout(() => done(""), ms);
    v.waiters.add(check);
  });
}

/** Drop a token the backend just rejected (401), so callers wait for a fresh one. */
export function invalidate(aud: Audience, tok: string): void {
  const v = vault();
  if (v.tokens.get(aud)?.tok === tok) v.tokens.delete(aud);
}

export function region(kind: "chatsvc" | "mt" | "ups"): string {
  const r = vault().regions[kind];
  return r || (kind === "chatsvc" ? "de" : "emea");
}

/** Signed-in user's object id, from the ic3 token (empty until captured). */
export function myOid(): string {
  const t = token("ic3");
  return t ? String(claims(t).oid || "") : "";
}

/** Diagnostics without secrets: which audiences are live and until when. */
export function authStatus(): Record<string, { expiresIn: number; seenAgo: number }> {
  const out: Record<string, { expiresIn: number; seenAgo: number }> = {};
  for (const [k, e] of vault().tokens) {
    out[k] = {
      expiresIn: e.exp ? Math.round((e.exp - Date.now()) / 1000) : -1,
      seenAgo: Math.round((Date.now() - e.at) / 1000),
    };
  }
  return out;
}
