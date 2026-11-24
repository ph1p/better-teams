// Teams IndexedDB rows and chatsvc REST payloads enter as `unknown` and are
// narrowed here, so no other module ever touches an `any`.
import type { WriteResult } from "../types";

export const toWrite = (r: { ok: true } | { ok: false; reason: string }, via?: string): WriteResult =>
  r.ok ? (via ? { ok: true, via } : { ok: true }) : { ok: false, reason: r.reason };

export type Dict = Record<string, unknown>;

export const isObj = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
export const obj = (v: unknown): Dict => (isObj(v) ? v : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown) => (typeof v === "string" ? v : "");
// undefined when malformed; non-strings pass through.
export const parsed = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return undefined;
  }
};
export const get = (v: unknown, key: string) => (isObj(v) ? v[key] : undefined);

export const toMs = (v: unknown) => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v);
  const n = Number(s);
  return Number.isFinite(n) ? n : Date.parse(s) || 0;
};

export const extOf = (name: string) => (/\.(\w+)$/.exec(name)?.[1] || "").toLowerCase();

// "https://…/contacts/8:orgid:<oid>" or "8:orgid:<oid>" -> "8:orgid:<oid>"
export const mriOf = (s: unknown) => (String(s ?? "").match(/\d+:[^/]+$/) || [""])[0];
