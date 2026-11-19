// One request path for every service call.
//
// - Egress guard: a request may only go to the Microsoft backends Teams itself
//   talks to (ALLOWED_HOSTS). Anything else is refused before it leaves the page,
//   so a bug can never ship a token or message content to a foreign host.
// - Auth: attaches the bearer Teams uses for that audience (auth.ts). If none is
//   captured yet it waits briefly for Teams to use one.
// - 401: drops the stale token, waits for Teams' next one, retries once.
// - Never throws; every outcome is a typed Res. Never logs headers or bodies.

import { invalidate, whenToken, type Audience } from "./auth";

const ALLOWED_HOSTS: RegExp[] = [
  /^teams\.microsoft\.com$/,
  /^teams\.cloud\.microsoft$/,
  /^[a-z0-9-]+\.teams\.microsoft\.com$/, // presence, chatsvcagg, …
  /^[a-z]{2,4}-prod\.asyncgw\.teams\.microsoft\.com$/, // AMS
  /^substrate\.office\.com$/,
  /^graph\.microsoft\.com$/,
];

export function allowedUrl(url: string): URL | null {
  try {
    const u = new URL(url, location.origin);
    if (u.protocol !== "https:") return null;
    return ALLOWED_HOSTS.some((re) => re.test(u.hostname)) ? u : null;
  } catch {
    return null;
  }
}

export type Res<T = unknown> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; reason: string };

export interface CallOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown; // JSON-encoded unless it is a BodyInit (Blob, ArrayBuffer, string)
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** How long to wait for Teams to produce a token if none is captured yet. */
  tokenWaitMs?: number;
}

const isRawBody = (b: unknown): b is BodyInit =>
  typeof b === "string" || b instanceof Blob || b instanceof ArrayBuffer || ArrayBuffer.isView(b);

async function once(url: URL, tok: string, o: CallOptions): Promise<Response> {
  const headers: Record<string, string> = { authorization: "Bearer " + tok, ...o.headers };
  let body: BodyInit | undefined;
  if (o.body !== undefined) {
    if (isRawBody(o.body)) body = o.body;
    else {
      body = JSON.stringify(o.body);
      headers["content-type"] ??= "application/json";
    }
  }
  // Same-origin paths stay relative so the page's own cookie plumbing applies.
  const target = url.origin === location.origin ? url.pathname + url.search : url.href;
  return fetch(target, { method: o.method || "GET", headers, body, credentials: o.credentials });
}

export async function call<T = unknown>(aud: Audience, url: string, o: CallOptions = {}): Promise<Res<T>> {
  const u = allowedUrl(url);
  if (!u) return { ok: false, status: 0, reason: "egress-blocked" };
  let tok = await whenToken(aud, o.tokenWaitMs ?? 0);
  if (!tok) return { ok: false, status: 0, reason: "no-token" };
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try {
      r = await once(u, tok, o);
    } catch {
      return { ok: false, status: 0, reason: "fetch-failed" };
    }
    if (r.status === 401 && attempt === 0) {
      invalidate(aud, tok);
      tok = await whenToken(aud, 8_000);
      if (!tok) return { ok: false, status: 401, reason: "no-token" };
      continue;
    }
    if (!r.ok) return { ok: false, status: r.status, reason: "http-" + r.status };
    const text = await r.text().catch(() => "");
    let data: unknown = text;
    if (text && /json/i.test(r.headers.get("content-type") || "")) {
      try {
        data = JSON.parse(text);
      } catch {
        /* keep text */
      }
    }
    return { ok: true, status: r.status, data: data as T };
  }
  return { ok: false, status: 401, reason: "unauthorized" };
}
