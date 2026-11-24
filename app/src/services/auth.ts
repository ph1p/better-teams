// Token vault for the service layer.
//
// Teams authenticates every backend call with a bearer for that backend's
// audience (chatsvc = ic3, people search = SubstrateSearch, presence, graph, …).
// We never mint tokens ourselves. We wrap the page's fetch and XMLHttpRequest
// once and read the Authorization header off Teams' OWN outgoing requests —
// passively: the request is never blocked, altered or re-sent. Each bearer is
// filed under its audience (the JWT `aud` claim), so any service module can ask
// for "the token Teams uses for X".
//
// Teams makes most backend calls (chatsvc, mt, csa, presence) from its web
// worker, which gets its tokens from the page over the CDL channel, not through
// fetch; page capture alone never sees those bearers, or stops seeing ic3 once
// the first one expires. For those audiences we ask the same page handler the
// worker uses (cdlToken) when the vault has no live token or it is about to
// expire.
//
// Tokens live in memory only, in this Teams instance. They are never logged,
// persisted or sent anywhere except back to the same Microsoft backend they came
// from (http.ts enforces that with an egress allowlist).
//
// The vault hangs off a Symbol.for key so a hot re-injected overlay build keeps
// the tokens the previous build already captured. All Teams windows share the
// tokens through the hidden host page they are opened from: a popped-out chat
// window makes few backend calls of its own and, with tokens of its own, never
// saw a chatsvc token and could not load messages.

import { cdlAccountOid, cdlConsumer, cdlSkypeToken, cdlToken } from "./cdl";

export type Audience =
  | "ic3" // chatsvc / asyncgw (messages, conversations, AMS)
  | "substrate" // substrate.office.com (people search, suggestions)
  | "presence" // presence.teams.microsoft.com
  | "graph" // graph.microsoft.com
  | "chatsvcagg" // /api/csa (channel posts, tag cards)
  | "mt" // /api/mt (short profiles, team apps); aud api.spaces.skype.com
  | "skype" // consumer chatsvc (teams.live.com); X-Skypetoken, not a JWT
  | "other";

interface Entry {
  tok: string;
  exp: number; // epoch ms; 0 = unknown
  at: number; // when we last saw Teams use it
  aud: string; // raw aud claim, for diagnostics
}

interface Vault {
  tokens: Map<Audience, Entry>;
  // Backend regions read off Teams' traffic; `mri` is the consumer account's
  // MRI from its skype token (work accounts derive theirs from the oid).
  regions: { chatsvc?: string; mt?: string; ups?: string; mri?: string };
  waiters: Set<() => void>;
  /** Which of this realm's request APIs are wrapped; never shared. */
  installed: { fetch?: boolean; xhr?: boolean };
}

const KEY = Symbol.for("better-teams.vault");
type VaultHost = { [KEY]?: Vault };

// The realm this module runs in: `window` in the host/child page, the worker
// global scope inside a web worker. globalThis resolves to whichever applies,
// so the same capture code wraps fetch/XHR wherever it is placed. A worker
// cannot reach the page vault; it forwards a captured header with
// ingestAuthHeader (see below).
function g() {
  return globalThis as unknown as VaultHost;
}

// The hidden host page every Teams window is opened from, reached as
// `window.opener` (as in cdl.ts); null if this realm has none.
function sharedHost(): VaultHost | null {
  try {
    const o = typeof window === "undefined" ? null : (window.opener as (Window & VaultHost) | null);
    if (o && o !== window && o.location.origin === location.origin) return o;
  } catch {
    /* cross-origin opener; ignore */
  }
  return null;
}

function realmVault(host: VaultHost) {
  let v = host[KEY];
  if (!v) {
    v = { tokens: new Map(), regions: {}, waiters: new Set(), installed: {} };
    Object.defineProperty(host, KEY, { value: v, enumerable: false });
  }
  return v;
}

function vault() {
  const v = realmVault(g());
  const host = sharedHost();
  if (!host) return v;
  const shared = realmVault(host);
  if (v.tokens !== shared.tokens) {
    // First use in this window: merge what it captured so far, then point its
    // vault at the host's maps. Wraps an earlier build installed look the vault
    // up by key on every request, so they file into the shared maps from now on.
    for (const [k, e] of v.tokens) {
      const s = shared.tokens.get(k);
      if (!s || s.exp < e.exp) shared.tokens.set(k, e);
    }
    for (const [k, r] of Object.entries(v.regions) as [keyof Vault["regions"], string][]) shared.regions[k] ??= r;
    for (const w of v.waiters) shared.waiters.add(w);
    v.tokens = shared.tokens;
    v.regions = shared.regions;
    v.waiters = shared.waiters;
  }
  return v;
}

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

function remember(authHeader: string, url: string) {
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
  notify();
}

function notify() {
  const v = vault();
  for (const w of Array.from(v.waiters)) {
    // A waiter from a window that has since closed must not stop the others.
    try {
      w();
    } catch {
      v.waiters.delete(w);
    }
  }
}

function noteRegion(url: string) {
  const v = vault();
  const cs = /https:\/\/([a-z]{2,4})-prod\.asyncgw/.exec(url) || /\/api\/chatsvc\/([a-z]{2,4}|consumer)\//.exec(url);
  if (cs) v.regions.chatsvc = cs[1];
  // Consumer mt has no region segment: /api/mt/beta/…
  const mt = /\/api\/mt\/(?!beta\/)([a-z]{2,4})\//.exec(url);
  if (mt) v.regions.mt = mt[1];
  const ups = /\/ups\/([a-z]{2,4})\/v1\//.exec(url);
  if (ups) v.regions.ups = ups[1];
}

type HeaderLike = Headers | Record<string, string> | [string, string][] | undefined;

function authOf(headers: HeaderLike) {
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

function installFetch() {
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

function installXhr() {
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

// Idempotent; safe from every (re-)injected build and from any realm (page or
// worker). Teams issues several backend tokens (mt, csa/chatsvcagg, presence)
// only from its web workers, whose fetch/XHR never cross the page realm. Run
// inside a worker, this captures them into that worker's vault; forward them to
// the page with ingestAuthHeader.
export function installAuthCapture() {
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

// Files an Authorization header captured in another realm (e.g. the CDP
// presence bridge) as if seen here. Passive: nothing is sent. `header` is
// "Bearer <jwt>" off Teams' own request, `url` its URL (for region detection).
export function ingestAuthHeader(header: string, url = "") {
  try {
    remember(header, url);
  } catch {
    /* ignore malformed input */
  }
}

// Resources Teams' own worker requests from the page (its CDL resource keys).
const RESOURCE: Partial<Record<Audience, string>> = {
  ic3: "https://ic3.teams.office.com",
  mt: "https://api.spaces.skype.com",
  chatsvcagg: "https://chatsvcagg.teams.microsoft.com",
  presence: "https://presence.teams.microsoft.com",
};

// One request per audience at a time. A failed request, or one that brought no
// token good for longer than RENEW_MS, backs off before the next try.
const asking = new Map<Audience, Promise<void>>();
const failedAt = new Map<Audience, number>();
const RETRY_MS = 30_000;
// Ask for a fresh token this long before the held one expires.
const RENEW_MS = 5 * 60_000;

function refresh(aud: Audience): Promise<void> | null {
  const resource = RESOURCE[aud];
  if (!resource && aud !== "skype") return null;
  const busy = asking.get(aud);
  if (busy) return busy;
  if (Date.now() - (failedAt.get(aud) || 0) < RETRY_MS) return null;
  const p = (resource ? refreshAad(aud, resource) : refreshSkype())
    .catch(() => void failedAt.set(aud, Date.now()))
    .finally(() => asking.delete(aud));
  asking.set(aud, p);
  return p;
}

function refreshAad(aud: Audience, resource: string) {
  return cdlToken(resource).then((tok) => {
    const c = tok ? claims(tok) : {};
    const fresh = typeof c.exp === "number" && c.exp * 1000 - Date.now() > RENEW_MS;
    if (tok && classify(String(c.aud || ""), "") === aud) remember("Bearer " + tok, "");
    if (!fresh) failedAt.set(aud, Date.now());
  });
}

// Consumer chatsvc takes the skype token Teams' worker gets from the page
// (getSkypeTokens). It is opaque, so its lifetime comes with the reply.
function refreshSkype() {
  return cdlSkypeToken().then((r) => {
    // A missing or nearly expired token still blocks retries for RETRY_MS.
    if (!r || (r.exp && r.exp - Date.now() <= RENEW_MS)) failedAt.set("skype", Date.now());
    if (!r) return;
    const v = vault();
    v.tokens.set("skype", { tok: r.token, exp: r.exp, at: Date.now(), aud: "skype" });
    if (r.mri) v.regions.mri = r.mri;
    notify();
  });
}

const SKEW_MS = 60_000;

export function token(aud: Audience) {
  const e = vault().tokens.get(aud);
  const left = e ? (e.exp ? e.exp - Date.now() : Infinity) : 0;
  if (left < RENEW_MS) void refresh(aud);
  if (!e || left < SKEW_MS) return "";
  return e.tok;
}

// For audiences we can request ourselves, waits for that request even if `ms` is 0.
export async function whenToken(aud: Audience, ms = 10_000): Promise<string> {
  const now = token(aud);
  if (now) return now;
  const asked = asking.get(aud);
  if (asked) {
    await asked;
    const t = token(aud);
    if (t || !ms) return t;
  }
  const v = vault();
  return new Promise((resolve) => {
    const done = (t: string) => {
      v.waiters.delete(check);
      clearTimeout(timer);
      resolve(t);
    };
    const check = () => {
      const t = token(aud);
      if (t) done(t);
    };
    const timer = setTimeout(() => done(""), ms);
    v.waiters.add(check);
  });
}

export function invalidate(aud: Audience, tok: string) {
  const v = vault();
  if (v.tokens.get(aud)?.tok === tok) v.tokens.delete(aud);
}

const consumerHost = (() => {
  try {
    return /(^|\.)teams\.live\.com$/.test(location.hostname);
  } catch {
    return false; // no location in this realm
  }
})();
// A page never switches between work and personal; cache the answer once known.
let consumer = consumerHost;
export function isConsumer() {
  return consumer || (consumer = cdlConsumer());
}

export function chatAud(): Audience {
  return isConsumer() ? "skype" : "ic3";
}

export function region(kind: "chatsvc" | "mt" | "ups") {
  const r = vault().regions[kind];
  if (r) return r;
  if (kind === "chatsvc") return isConsumer() ? "consumer" : "de";
  return "emea";
}

// Consumer account's own MRI ("8:<skype id>"). Teams keeps it in clear next to
// its (encrypted) cached skype token, so it is readable before our first
// getSkypeTokens round trip. Scanned once; after that only refreshSkype fills it.
let mriScanned = false;
export function consumerMri() {
  if (!isConsumer()) return "";
  const v = vault();
  if (v.regions.mri) return v.regions.mri;
  // Keys are tmp.auth.v1.<account id>.…; the account id is the MSA oid's tail.
  if (mriScanned) return "";
  mriScanned = true;
  const account = cdlAccountOid().replace(/-/g, "").replace(/^0+/, "");
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      if (!k.endsWith(".Discover.SKYPE-TOKEN") || (account && !k.includes(account))) continue;
      type Cached = { item?: { userDetails?: { id?: unknown } } };
      const id = (JSON.parse(localStorage.getItem(k) || "{}") as Cached).item?.userDetails?.id;
      if (typeof id === "string" && id.startsWith("8:")) return (v.regions.mri = id);
    }
  } catch {
    /* storage blocked or malformed */
  }
  void refresh("skype");
  return "";
}

export function myOid() {
  const t = token("ic3");
  return t ? String(claims(t).oid || "") : "";
}

// Diagnostics without secrets.
export function authStatus() {
  const out: Record<string, { expiresIn: number; seenAgo: number }> = {};
  for (const [k, e] of vault().tokens) {
    out[k] = {
      expiresIn: e.exp ? Math.round((e.exp - Date.now()) / 1000) : -1,
      seenAgo: Math.round((Date.now() - e.at) / 1000),
    };
  }
  return out;
}
