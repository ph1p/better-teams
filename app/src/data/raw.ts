// Untyped-data accessors. Teams IndexedDB rows and chatsvc REST payloads are
// untyped external data: they enter as `unknown` and are narrowed here, so no
// other module ever touches an `any`.
import type { WriteResult } from "../types";
import type { Res } from "../services";

// Service-layer result -> the UI's WriteResult.
export const toWrite = (r: Res): WriteResult => (r.ok ? { ok: true } : { ok: false, reason: r.reason });

export type Dict = Record<string, unknown>;

export const isObj = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
export const obj = (v: unknown): Dict => (isObj(v) ? v : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** Read one property off a possibly-non-object value. */
export const get = (v: unknown, key: string): unknown => (isObj(v) ? v[key] : undefined);

export const toMs = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v);
  const n = Number(s);
  return Number.isFinite(n) ? n : Date.parse(s) || 0;
};

// "https://…/contacts/8:orgid:<oid>" or "8:orgid:<oid>" -> "8:orgid:<oid>"
/** Lower-case extension of a file name ("Plan.PDF" -> "pdf"), "" when none. */
export const extOf = (name: string): string => (/\.(\w+)$/.exec(name)?.[1] || "").toLowerCase();

export const mriOf = (s: unknown): string => (String(s ?? "").match(/\d+:[^/]+$/) || [""])[0];
