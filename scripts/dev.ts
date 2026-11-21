// Dev reloader: watches the overlay bundle and re-injects it into every visible
// Teams window over CDP whenever it is rebuilt (pair with `vite build --watch`).
//
// Teams must run with remote debugging on port 9222 (`teams-calm dev` does
// that). Each reinjection replaces the running overlay in place (mount.tsx
// destroys the previous build when __BUILD__ differs); Teams itself keeps
// running. A new-document script is kept per window so a reload of that window
// gets the latest dev build too. The patched-in production overlay is replaced
// the same way, so dev and patch can coexist.
//
// Usage: node scripts/dev.ts <bundle.js>

import { readFileSync, watch, existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { startPresenceBridge, type CdpMsg, type CdpTarget } from "./presence-bridge.ts";

type Send = (method: string, params?: object) => Promise<CdpMsg>;
interface Page { send: Send; ws: WebSocket; title: string; scriptId?: string; host?: false }
interface HostPage { host: true; ws: WebSocket }

const PORT = 9222;
const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("Usage: node scripts/dev.ts <bundle.js>");
  process.exit(1);
}

const pages = new Map<string, Page | HostPage | null>(); // null = connecting
let js: string | null = existsSync(bundlePath) ? readFileSync(bundlePath, "utf8") : null;

const log = (...a: unknown[]) => console.log(`[dev ${new Date().toLocaleTimeString()}]`, ...a);

function connect(t: CdpTarget): Promise<{ ws: WebSocket; send: Send }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(t.webSocketDebuggerUrl);
    let id = 0;
    const waits = new Map<number, (x: CdpMsg) => void>();
    ws.addEventListener("message", (e) => {
      let x: CdpMsg; try { x = JSON.parse(String(e.data)); } catch { return; }
      const w = x.id ? waits.get(x.id) : undefined;
      if (w) { w(x); waits.delete(x.id!); }
    });
    ws.addEventListener("close", () => { pages.delete(t.id); });
    ws.addEventListener("error", reject);
    ws.addEventListener("open", () => {
      const send: Send = (method, params = {}) => new Promise((r) => {
        const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
      });
      resolve({ ws, send });
    });
  });
}

async function inject(p: Page) {
  if (!js) return;
  if (p.scriptId) await p.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: p.scriptId });
  const add = await p.send("Page.addScriptToEvaluateOnNewDocument", { source: js });
  p.scriptId = add.result?.identifier as string | undefined;
  const res = await p.send("Runtime.evaluate", { expression: js });
  const err = res.result?.exceptionDetails as { text?: string; exception?: { description?: string } } | undefined;
  log(err ? `error in ${p.title}: ${err.exception?.description ?? err.text}` : `reloaded ${p.title}`);
}

// Find visible Teams windows. The hidden 1x1 host page (where Teams' own
// client-bindings run) is skipped: it has `nativeModules` and no UI.
async function scan() {
  let list: CdpTarget[];
  try { list = await (await fetch(`http://localhost:${PORT}/json`)).json(); }
  catch { return; }
  for (const t of list) {
    if (t.type !== "page" || !/teams\.microsoft\.com/.test(t.url || "") || pages.has(t.id)) continue;
    pages.set(t.id, null); // reserve while connecting
    try {
      const { ws, send } = await connect(t);
      const probe = await send("Runtime.evaluate", { expression: "!!self.nativeModules || innerWidth <= 1", returnByValue: true });
      if ((probe.result?.result as { value?: unknown } | undefined)?.value) { pages.set(t.id, { host: true, ws }); continue; }
      await send("Page.enable");
      const p: Page = { send, ws, title: JSON.stringify((t.title || "").slice(0, 30)) };
      pages.set(t.id, p);
      await inject(p);
    } catch {
      pages.delete(t.id);
    }
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(dirname(bundlePath), (_ev, file) => {
  if (file !== basename(bundlePath)) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try { js = readFileSync(bundlePath, "utf8"); } catch { return; }
    for (const p of pages.values()) if (p && !p.host) await inject(p).catch((e: Error) => log("inject failed:", e.message));
  }, 150);
});

log(`watching ${bundlePath}; scanning CDP :${PORT} for Teams windows`);
await scan();
setInterval(scan, 1500);

// Feed Teams' own live presence into the overlay (trouter worker socket -> page
// global). Retried until the worker exists; restarted if its socket drops.
let bridgeRunning = false;
async function ensureBridge() {
  if (bridgeRunning) return;
  bridgeRunning = true;
  try {
    const stop = await startPresenceBridge(log, () => { bridgeRunning = false; });
    if (!stop) bridgeRunning = false; // nothing to tap yet; retry next tick
  } catch (e) { log("presence bridge:", (e as Error).message); bridgeRunning = false; }
}
await ensureBridge();
setInterval(ensureBridge, 5000);
