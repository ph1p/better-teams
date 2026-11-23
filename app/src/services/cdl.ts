// CDL client: talk to Teams' backends exactly the way the Teams UI does.
//
// The Teams UI never calls its backends directly. It posts GraphQL envelopes
// (as JSON strings) to its main web worker; the worker runs the REST calls with
// its own tokens and posts the result back (docs/cdl-api.md). Both Worker
// instances live in the hidden 1x1 host page, which every visible window is
// window.open()'d from, so `window.opener` reaches them — in prod (overlay runs
// inside `with (childWindow)`) and in dev (injected into the child page) alike.
//
// We wrap the host realm's Worker.prototype.postMessage once and learn, from
// Teams' own traffic, which worker serves GraphQL and the envelope context
// (rendererId, windowId, authenticationUser). Requests we send are identical in
// form; replies are matched by requestId on a listener added to that worker.
// GraphQL calls touch no tokens: the worker authenticates exactly as for
// Teams' UI. Nothing leaves the page except through Teams' own worker.
//
// The same channel runs the other way for auth: the worker asks the page for
// AAD tokens ({type:"auth", payload:{requestOperationtype:"aadGetToken"}}) and
// the page answers through Worker.prototype.postMessage. cdlToken() asks that
// page handler the same way, as if it were the worker, and takes the answer
// out of the wrapper before it reaches the real worker (see cdlToken()).

const KEY = Symbol.for("better-teams.cdl");

interface Ctx {
  worker: Worker;
  rendererId: string;
  windowId: string;
  authenticationUser: unknown;
}

type Reply = { status?: string; response?: { data?: unknown; errors?: unknown[] }; errors?: unknown[] };

interface State {
  ctx?: Ctx;
  post?: (this: Worker, msg: unknown, ...rest: unknown[]) => void; // original postMessage
  listening: WeakSet<Worker>;
  pending: Map<string, (r: Reply) => void>;
  /** Live subscriptions: replies keep coming under the same requestId. */
  subs?: Map<string, (r: Reply) => void>;
  /** Workers carrying the current routing listener (see listen()). */
  routed?: WeakSet<Worker>;
  /** Reply router; replaced by every (re-)injected build. */
  route?: (d: unknown) => void;
  waiters: Set<() => void>;
  seq: number;
  /** Answers to our own auth requests, keyed by requestId; see cdlToken(). */
  auth?: Map<string, (r: AuthReply) => void>;
  /** Version of the postMessage wrapper installed on the host page. */
  wrap?: number;
}

type AuthReply = { status?: string; response?: { data?: { token?: unknown } } };

type HostWin = Window & typeof globalThis & { [KEY]?: State };

// The realm that owns Teams' workers: the host page. Falls back to this window
// (e.g. if Teams ever stops using window.open), where install() then finds no
// GraphQL traffic and ready() stays false.
function hostWin(): HostWin {
  try {
    const o = window.opener as HostWin | null;
    if (o && o.location.origin === location.origin && typeof o.Worker === "function") return o;
  } catch {
    /* cross-origin opener; ignore */
  }
  return window as HostWin;
}

function state(): State {
  const h = hostWin();
  let s = h[KEY];
  if (!s) {
    s = { listening: new WeakSet(), pending: new Map(), waiters: new Set(), seq: 0 };
    Object.defineProperty(h, KEY, { value: s, enumerable: false });
  }
  return s;
}

// Replies start with {"requestId":"…"; peek at the id before parsing so only
// our own replies pay for JSON.parse.
const ID_RE = /^\{"requestId":"([^"]+)"/;

function route(s: State, d: unknown): void {
  let id = "";
  if (typeof d === "string") id = ID_RE.exec(d)?.[1] || "";
  else if (d && typeof d === "object") id = String((d as { requestId?: unknown }).requestId || "");
  if (!id) return;
  const sub = s.subs?.get(id);
  if (sub) return sub((typeof d === "string" ? JSON.parse(d) : d) as Reply);
  const done = s.pending.get(id);
  if (!done) return;
  s.pending.delete(id);
  done((typeof d === "string" ? JSON.parse(d) : d) as Reply);
}

// One listener per worker for the life of the host page; it calls whatever
// router the newest build installed, so re-injection picks up new routing.
// (A listener left by an older build only resolves `pending`, which is harmless:
// whichever runs first deletes the entry.)
function listen(s: State, w: Worker): void {
  s.route = (d) => route(s, d);
  s.routed ??= new WeakSet();
  s.listening.add(w);
  if (s.routed.has(w)) return;
  s.routed.add(w);
  w.addEventListener("message", (e: MessageEvent) => {
    try {
      s.route?.(e.data);
    } catch {
      /* never disturb Teams' own handlers */
    }
  });
}

function learn(s: State, w: Worker, msg: unknown): void {
  if (typeof msg !== "string" || msg.indexOf('"type":"graphql"') < 0 || msg.indexOf("cdlOperationCustomContext") < 0)
    return;
  const m = JSON.parse(msg) as {
    rendererId?: string;
    windowId?: string;
    payload?: { graphqlQuery?: string };
    cdlOperationCustomContext?: { authenticationUser?: unknown };
  };
  const au = m.cdlOperationCustomContext?.authenticationUser;
  if (!m.rendererId || !m.windowId || !au || m.payload?.graphqlQuery === "GQL_STOP") return;
  const first = !s.ctx;
  s.ctx = { worker: w, rendererId: m.rendererId, windowId: m.windowId, authenticationUser: au };
  listen(s, w);
  if (first) for (const f of Array.from(s.waiters)) f(); // snapshot: callbacks may unsubscribe
}

// Our auth requests use this prefix, so the page's answers are told apart
// from Teams' own by their first bytes.
const AUTH_ID = "tc-auth-";
const AUTH_HEAD = `{"requestId":"${AUTH_ID}`;
const WRAP = 2;

// True if `msg` answers one of our auth requests; it is then consumed here and
// must not reach the worker (which would drop it and log it to telemetry).
function takeAuth(s: State, msg: unknown): boolean {
  if (typeof msg !== "string" || !msg.startsWith(AUTH_HEAD)) return false;
  const id = ID_RE.exec(msg)?.[1] || "";
  const done = s.auth?.get(id);
  if (done) {
    s.auth!.delete(id);
    done(JSON.parse(msg) as AuthReply);
  }
  return true;
}

/** Idempotent; safe from every (re-)injected build and every child window. */
export function installCdl(): void {
  const s = state();
  // A re-injected build installs its own router on the already-known worker.
  if (s.ctx) listen(s, s.ctx.worker);
  // An older build's wrapper (dev hot reload) does not know takeAuth; wrap once
  // more on top of it. `s.post` stays the true original for our own sends.
  if ((s.wrap ?? (s.post ? 1 : 0)) >= WRAP) return;
  const P = hostWin().Worker.prototype;
  const below = P.postMessage as (...a: unknown[]) => void;
  const learns = !s.post;
  s.post ??= below as State["post"];
  s.wrap = WRAP;
  P.postMessage = function (this: Worker, msg: unknown, ...rest: unknown[]): void {
    try {
      if (takeAuth(s, msg)) return;
      if (learns) learn(s, this, msg);
    } catch {
      /* our hooks must never break Teams' own messages */
    }
    return below.call(this, msg, ...rest);
  } as typeof P.postMessage;
}

/** True once Teams has sent one GraphQL request we could learn from. */
export function cdlReady(): boolean {
  return !!state().ctx;
}

/** Resolves true when ready, false after `ms`. */
export function whenCdl(ms = 10_000): Promise<boolean> {
  installCdl();
  const s = state();
  if (s.ctx) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (v: boolean): void => {
      s.waiters.delete(ok);
      clearTimeout(t);
      resolve(v);
    };
    const ok = (): void => done(true);
    const t = setTimeout(() => done(false), ms);
    s.waiters.add(ok);
  });
}

// Teams counts from ~1000 per session; a high base keeps us clear of its ids.
function nextId(s: State, kind: "q" | "m" | "s"): string {
  return `${kind}-${900_000 + ++s.seq}`;
}

function envelope(
  ctx: Ctx,
  requestId: string,
  operationName: string,
  query: string,
  variables: unknown,
  callerInfo?: string,
) {
  return {
    requestId,
    rendererId: ctx.rendererId,
    windowId: ctx.windowId,
    payload: { graphqlQuery: query, variables },
    operationName,
    type: "graphql",
    cdlOperationCustomContext: {
      authenticationUser: ctx.authenticationUser,
      ...(callerInfo ? { callerInfo } : {}),
    },
  };
}

export type CdlRes<T> = { ok: true; data: T } | { ok: false; reason: string };

/**
 * Pick one mutation/query result field. A missing field, or one whose
 * __typename matches `bad` (Teams' `...Error` types), turns into a failure.
 */
export function check<T>(r: CdlRes<Record<string, unknown>>, field: string, bad?: RegExp): CdlRes<T> {
  if (!r.ok) return r;
  const v = r.data[field] as
    | { __typename?: string; errorCode?: string; errorType?: string; errorMessage?: string }
    | null
    | undefined;
  if (!v) return { ok: false, reason: `no ${field}` };
  if (bad && v.__typename && bad.test(v.__typename)) {
    const code = v.errorCode || v.errorType;
    return {
      ok: false,
      reason: `${v.__typename}${code ? ": " + code : ""}${v.errorMessage ? " " + v.errorMessage : ""}`,
    };
  }
  return { ok: true, data: v as T };
}

/**
 * Run one GraphQL query or mutation through Teams' worker. `query` must be the
 * document Teams itself sends for `operationName` (see docs/cdl-catalog.json).
 * Never throws.
 */
export async function cdl<T = Record<string, unknown>>(
  operationName: string,
  query: string,
  variables: unknown,
  opts: { callerInfo?: string; timeoutMs?: number } = {},
): Promise<CdlRes<T>> {
  if (!(await whenCdl(5_000))) return { ok: false, reason: "Teams worker channel not ready" };
  const s = state();
  const ctx = s.ctx!;
  const kind = /^\s*mutation\b/.test(query) ? "m" : /^\s*subscription\b/.test(query) ? "s" : "q";
  if (kind === "s") return { ok: false, reason: "use cdlSubscribe" };
  const requestId = nextId(s, kind);
  const env = envelope(ctx, requestId, operationName, query, variables, opts.callerInfo);
  const reply = await new Promise<Reply | null>((resolve) => {
    const t = setTimeout(() => {
      s.pending.delete(requestId);
      resolve(null);
    }, opts.timeoutMs ?? 15_000);
    s.pending.set(requestId, (r) => {
      clearTimeout(t);
      resolve(r);
    });
    try {
      s.post!.call(ctx.worker, JSON.stringify(env));
    } catch (e) {
      clearTimeout(t);
      s.pending.delete(requestId);
      resolve({ status: "error", errors: [String(e)] });
    }
  });
  if (!reply) return { ok: false, reason: "timeout" };
  const errs = reply.response?.errors || reply.errors;
  if (reply.status !== "success" || !reply.response?.data) {
    return { ok: false, reason: errs?.length ? JSON.stringify(errs[0]).slice(0, 200) : reply.status || "no data" };
  }
  return { ok: true, data: reply.response.data as T };
}

/**
 * Ask Teams' page for an AAD access token for `resource` (e.g.
 * "https://ic3.teams.office.com"), exactly as its worker does when its own
 * token runs out: the page's CDL auth handler serves it from MSAL, renewing it
 * silently when due. The request is dispatched on the worker object, so the
 * page's own message handler takes it; it carries a rendererId of its own,
 * because the page treats messages with its own rendererId as responses.
 * The token stays in memory; the caller files it in the vault. Resolves "" on
 * failure or after `ms`. Never throws.
 */
export async function cdlToken(resource: string, ms = 8_000): Promise<string> {
  if (!(await whenCdl(Math.min(ms, 5_000)))) return "";
  installCdl();
  const s = state();
  const ctx = s.ctx!;
  const requestId = `${AUTH_ID}${++s.seq}`;
  s.auth ??= new Map();
  const reply = await new Promise<AuthReply | null>((resolve) => {
    const t = setTimeout(() => {
      s.auth!.delete(requestId);
      resolve(null);
    }, ms);
    s.auth!.set(requestId, (r) => {
      clearTimeout(t);
      resolve(r);
    });
    try {
      const req = {
        rendererId: "better-teams",
        windowId: ctx.windowId,
        requestId,
        type: "auth",
        payload: { requestOperationtype: "aadGetToken", context: { resource, options: {} } },
      };
      const W = hostWin() as HostWin;
      ctx.worker.dispatchEvent(new W.MessageEvent("message", { data: JSON.stringify(req) }));
    } catch {
      clearTimeout(t);
      s.auth!.delete(requestId);
      resolve(null);
    }
  });
  const tok = reply?.response?.data?.token;
  return typeof tok === "string" ? tok : "";
}

/**
 * Start a GraphQL subscription through Teams' worker. The worker answers
 * repeatedly under one `s-` requestId; `onData` gets each `response.data`.
 * The returned function stops it the way Teams does: same requestId with
 * `graphqlQuery:"GQL_STOP"` (no custom context, as recorded). Never throws.
 */
export function cdlSubscribe<T = Record<string, unknown>>(
  operationName: string,
  query: string,
  variables: unknown,
  onData: (data: T) => void,
  opts: { callerInfo?: string } = {},
): () => void {
  let stopped = false;
  let stop = (): void => {
    stopped = true;
  };
  void whenCdl(30_000).then((ok) => {
    if (!ok || stopped) return;
    const s = state();
    const ctx = s.ctx!;
    const requestId = nextId(s, "s");
    s.subs ??= new Map();
    s.subs.set(requestId, (r) => {
      if (r.status === "success" && r.response?.data) {
        try {
          onData(r.response.data as T);
        } catch {
          /* a consumer bug must not break routing */
        }
      }
    });
    try {
      s.post!.call(
        ctx.worker,
        JSON.stringify(envelope(ctx, requestId, operationName, query, variables, opts.callerInfo)),
      );
    } catch {
      s.subs.delete(requestId);
      return;
    }
    stop = (): void => {
      if (!s.subs?.delete(requestId)) return;
      try {
        s.post!.call(
          ctx.worker,
          JSON.stringify({
            requestId,
            rendererId: ctx.rendererId,
            windowId: ctx.windowId,
            payload: { graphqlQuery: "GQL_STOP", variables },
            operationName,
            type: "graphql",
          }),
        );
      } catch {
        /* worker gone; nothing to stop */
      }
    };
  });
  return () => stop();
}
