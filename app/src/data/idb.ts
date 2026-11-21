// Teams IndexedDB plumbing: find and open Teams' own databases, read rows.
import { get } from "./raw";

const DB_CACHE: Record<string, IDBDatabase> = {};

async function findDb(fragment: string): Promise<string | undefined> {
  const names = (await indexedDB.databases()).map((d) => d.name).filter((n): n is string => !!n);
  return names.find((n) => n.includes(`:${fragment}-manager:`)) || names.find((n) => n.includes(`:${fragment}:`));
}

export async function open(fragment: string): Promise<IDBDatabase> {
  const cached = DB_CACHE[fragment];
  if (cached) return cached;
  const name = await findDb(fragment);
  if (!name) throw new Error(`IndexedDB not found for "${fragment}"`);
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(name);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  // Teams upgrades its schema (e.g. replychains -> replychains-2) on reload;
  // drop our handle so the next call reopens the new version.
  db.onversionchange = () => {
    db.close();
    delete DB_CACHE[fragment];
  };
  db.onclose = () => delete DB_CACHE[fragment];
  DB_CACHE[fragment] = db;
  // Teams:<store>:react-web-client:<tenant>:<oid>:<locale>
  const parts = name.split(":");
  if (parts.length >= 3) CURRENT_OID = parts[parts.length - 2];
  return db;
}

export let CURRENT_OID = "";
export const myMri = (): string => (CURRENT_OID ? "8:orgid:" + CURRENT_OID : "");

function req(r: IDBRequest): Promise<unknown[]> {
  return new Promise((res) => {
    r.onsuccess = () => res((r.result as unknown[]) || []);
    r.onerror = () => res([]);
  });
}

export function getAll(db: IDBDatabase, store: string, limit?: number): Promise<unknown[]> {
  if (!db.objectStoreNames.contains(store)) return Promise.resolve([]);
  return req(db.transaction(store).objectStore(store).getAll(null, limit));
}

// All rows of `store` whose compound key/index starts with `prefix`.
export function getByPrefix(db: IDBDatabase, store: string, prefix: string): Promise<unknown[]> {
  const os = db.transaction(store).objectStore(store);
  const range = IDBKeyRange.bound([prefix], [prefix, []]);
  for (const ix of os.indexNames) {
    const kp = os.index(ix).keyPath;
    if (Array.isArray(kp) && kp[0] === "conversationId") return req(os.index(ix).getAll(range));
  }
  if (Array.isArray(os.keyPath) && os.keyPath[0] === "conversationId") return req(os.getAll(range));
  return req(os.getAll()).then((rows) => rows.filter((r) => get(r, "conversationId") === prefix));
}
