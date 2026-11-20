#!/usr/bin/env node
// Wrap the overlay bundle into a payload for Teams' own client-bindings/bundle.js.
//
// Teams (new, macOS) injects Resources/client-bindings/bundle.js only into a
// hidden 1x1 host page; every visible window is window.open()'d from it (same
// origin). The visible windows enforce Trusted Types, so no script can be
// injected into them. Instead the host page runs the overlay code itself, inside
// `with (childWindow)`, so `document`, `window`, `fetch`, timers etc. resolve to
// the child window — the overlay renders and wraps fetch there.
//
// Usage: node scripts/build-host-patch.mjs <bundle.js> <out.js>
import { readFileSync, writeFileSync } from "node:fs";

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("Usage: node scripts/build-host-patch.mjs <bundle.js> <out.js>"); process.exit(1); }
const app = readFileSync(src, "utf8");

// Presence in prod comes from the DOM presence badges Teams paints in each
// child window (presence.ts reads aria-label + colour class). The live trouter
// presence socket lives in Teams' host-page worker, which Trusted Types makes
// unreachable here: every `new Worker()` construction (blob, data:, or real URL)
// requires a TrustedScriptURL only Teams' own allow-listed policy can mint, so a
// worker-wrapper can't inject a tap and the CSP `trusted-types` allowlist blocks
// minting our own policy. The child realm carries no presence data either (no
// unifiedPresenceService traffic, no presence module among its webpack chunks),
// so there is nothing to tap without CDP. The dev reloader (dev.mjs) does tap the
// socket over CDP; prod relies on the DOM scrape, which already covers everyone
// Teams shows a badge for.

const payload = `
/*teams-calm:begin*/
;(function () {
  if (window.opener || self.__teamsCalmHost) return;
  self.__teamsCalmHost = 1;

  // Sloppy-mode on purpose: \`with\` routes free identifiers to the child window.
  function run(w) { with (w) { (function () {
${app}
  }).call(w); } }
  function watch(w) {
    var iv = setInterval(function () {
      try {
        if (w.closed) { clearInterval(iv); return; }
        var d = w.document;
        if (!d || !d.body || w.location.origin !== location.origin) return;
        if (w.__teamsCalmDoc === d) return; // already injected into this document
        w.__teamsCalmDoc = d;
        run(w);
      } catch (e) { console.warn("[teams-calm]", e); }
    }, 300);
  }
  var open0 = window.open;
  window.open = function () {
    var w = open0.apply(this, arguments);
    if (w) watch(w);
    return w;
  };
})();
/*teams-calm:end*/
`;
writeFileSync(out, payload);
console.log(`wrote ${out} (${(payload.length / 1024).toFixed(0)} KB)`);
