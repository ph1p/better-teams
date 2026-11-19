// Presence bridge: feeds Teams' own live presence into the overlay.
//
// Teams receives presence over a trouter websocket that lives inside a dedicated
// web worker (not the page), so no in-page script can reach it. This bridge runs
// on the injector (CDP) side: it finds that worker, enumerates its live sockets
// with Runtime.queryObjects (CDP-only), adds a second "message" listener to the
// trouter socket — which fires alongside Teams' own handler without disturbing it
// — parses each unifiedPresenceService frame to {mri, availability}, and pushes
// the pairs into window.__tcPresence on the page, where presence.ts merges them
// into its sticky cache. The availability strings Teams sends are already our
// Status values, so no mapping happens here.
//
// Robustness: trouter reconnects spawn a NEW socket instance, so we re-enumerate
// on an interval and tap any trouter socket we haven't tagged yet (s.__tctapped).
// Parsed frames queue on self.__tcq in the worker; a drain loop ships them to the
// page. Everything is idempotent, so repeated calls (e.g. after a reload) are safe.

const PORT = 9222;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pend = new Map();
    ws.addEventListener("message", (e) => {
      let j; try { j = JSON.parse(e.data); } catch { return; }
      if (j.id && pend.has(j.id)) { pend.get(j.id)(j.result || j.error); pend.delete(j.id); }
    });
    ws.addEventListener("error", reject);
    ws.addEventListener("close", () => { for (const r of pend.values()) r({ __closed: true }); });
    ws.addEventListener("open", () => {
      const call = (method, params = {}) => new Promise((r) => {
        const n = ++id; pend.set(n, r);
        ws.send(JSON.stringify({ id: n, method, params }));
        setTimeout(() => { if (pend.has(n)) { pend.delete(n); r({ __timeout: true }); } }, 5000);
      });
      resolve({ ws, call });
    });
  });
}

// Parse + tap, run inside the worker against the queryObjects result (an array of
// every live WebSocket). Appends [mri, availability] pairs to self.__tcq.
const TAP_FN = `function(){
  self.__tcq = self.__tcq || [];
  var sockets = this.filter(function(w){ return /trouter/.test(w.url); });
  var tapped = 0;
  sockets.forEach(function(s){
    if (s.__tctapped) return;
    s.__tctapped = true; tapped++;
    s.addEventListener("message", function(ev){
      var d = ev && ev.data;
      if (typeof d !== "string" || d.indexOf("unifiedPresenceService") === -1) return;
      try {
        var env = JSON.parse(d.slice(d.indexOf(":::") + 3));
        var body = JSON.parse(env.body);
        (body.presence || []).forEach(function(p){
          var pr = p.presence || {};
          var st = (pr.forcedAvailability && pr.forcedAvailability.availability) || pr.availability;
          if (p.mri && st) self.__tcq.push([p.mri, st]);
        });
      } catch (e) {}
    });
  });
  return tapped;
}`;

async function findTrouterWorker() {
  let list;
  try { list = await (await fetch(`http://localhost:${PORT}/json`)).json(); }
  catch { return null; }
  const workers = list.filter((x) => x.type === "worker" && x.webSocketDebuggerUrl);
  for (const w of workers) {
    let c;
    try { c = await Promise.race([connect(w.webSocketDebuggerUrl), new Promise((_, x) => setTimeout(x, 3000))]); }
    catch { continue; }
    await c.call("Runtime.enable");
    const r = await c.call("Runtime.evaluate", {
      expression: `performance.getEntriesByType("resource").some(x=>/trouter/i.test(x.name))`,
      returnByValue: true,
    });
    if (r.result && r.result.value === true) return c;
    c.ws.close();
  }
  return null;
}

async function findPage() {
  let list;
  try { list = await (await fetch(`http://localhost:${PORT}/json`)).json(); }
  catch { return null; }
  const t = list.find((x) => x.type === "page" && /teams\.microsoft\.com/.test(x.url || ""));
  if (!t) return null;
  const c = await connect(t.webSocketDebuggerUrl);
  await c.call("Runtime.enable");
  // Install the sink early in case the bundle isn't mounted yet; presence.ts
  // adopts this map and replaces push() when it loads.
  await c.call("Runtime.evaluate", {
    expression: `self.__tcPresence = self.__tcPresence || { map:{}, push:function(m,s){ this.map[m]=s; } };`,
  });
  return c;
}

// Enumerate the worker's live sockets and (re)tap trouter. Returns #newly tapped.
async function retap(worker) {
  const proto = await worker.call("Runtime.evaluate", { expression: "WebSocket.prototype" });
  if (!proto.result || !proto.result.objectId) return 0;
  const q = await worker.call("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId });
  if (!q.objects || !q.objects.objectId) return 0;
  const r = await worker.call("Runtime.callFunctionOn", {
    objectId: q.objects.objectId, returnByValue: true, functionDeclaration: TAP_FN,
  });
  return (r.result && r.result.value) || 0;
}

export async function startPresenceBridge(logFn = () => {}, onStop = () => {}) {
  const worker = await findTrouterWorker();
  if (!worker) { logFn("presence: no trouter worker found"); return null; }
  const page = await findPage();
  if (!page) { logFn("presence: no Teams page found"); worker.ws.close(); return null; }

  const tapped = await retap(worker);
  logFn(`presence: tapped ${tapped} trouter socket(s)`);

  let stopped = false;
  // Drain worker queue -> page. Also re-tap periodically to catch reconnects.
  const drainTimer = setInterval(async () => {
    if (stopped) return;
    try {
      const drain = await worker.call("Runtime.evaluate", {
        expression: `(function(){var q=self.__tcq||[];self.__tcq=[];return JSON.stringify(q);})()`,
        returnByValue: true,
      });
      if (drain.__closed || drain.__timeout) return;
      const items = JSON.parse((drain.result && drain.result.value) || "[]");
      for (const [mri, st] of items) {
        await page.call("Runtime.evaluate", {
          expression: `self.__tcPresence && self.__tcPresence.push(${JSON.stringify(mri)},${JSON.stringify(st)})`,
        });
      }
      if (items.length) logFn(`presence: forwarded ${items.length}`);
    } catch { /* worker or page went away; retap timer recovers */ }
  }, 1000);

  const retapTimer = setInterval(async () => {
    if (stopped) return;
    try { await retap(worker); } catch { /* ignore */ }
  }, 5000);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(drainTimer); clearInterval(retapTimer);
    try { worker.ws.close(); } catch {}
    try { page.ws.close(); } catch {}
    try { onStop(); } catch {}
  };
  worker.ws.addEventListener("close", stop);
  page.ws.addEventListener("close", stop);
  return stop;
}

// Allow running standalone: `node presence-bridge.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const log = (...a) => console.log(`[presence ${new Date().toLocaleTimeString()}]`, ...a);
  const stop = await startPresenceBridge(log);
  if (!stop) process.exit(1);
  log("bridge running; Ctrl+C to stop");
  process.on("SIGINT", () => { stop(); process.exit(0); });
}
