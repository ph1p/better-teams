// Production entry: injected as one IIFE into the Teams page. Mounts a
// full-screen React overlay above Teams, toggled with Option+Cmd+T. Teams keeps
// running underneath, so calls, meetings and files still work natively.
import { createRoot } from "react-dom/client";
import App from "./ui/App";
import { CSS } from "./styles";
import { installAuthCapture, installCdl } from "./services";
import { t } from "./i18n";

const ROOT_ID = "tc-root";
const STYLE_ID = "tc-style";
const PILL_ID = "tc-pill";

function ensureStyle(): void {
  let s = document.getElementById(STYLE_ID);
  if (!s) {
    s = document.createElement("style");
    s.id = STYLE_ID;
    document.head.appendChild(s);
  }
  if (s.textContent !== CSS) s.textContent = CSS;
}

// True when THIS window is showing an active call/meeting stage. Teams converts
// a chat window into the call in place (same window.open'd document), so the
// overlay — which paints over everything and has no video — would hide the call.
// We detect the call UI by stable, locale-independent data-tids Teams only
// renders on the calling screen (the leave button's toolbar, the video stage,
// the call status/duration). aria-labels are localised, so we never key on them.
const CALL_TIDS = [
  '[data-tid="calling-screen-background"]',
  '[data-tid="calling-stream"]',
  '[data-tid="call-status"]',
  '[data-tid="call-duration"]',
  '[data-tid="ubar-toolbar-wrapper"]',
].join(",");
function isCallWindow(): boolean {
  return !!document.querySelector(CALL_TIDS);
}

function mount(): NonNullable<Window["__betterTeamsApp"]> {
  // Capture Teams' own ic3 bearer off its chatsvc calls, so uncached chats can
  // load from the same backend. Idempotent; survives re-injection.
  installAuthCapture();
  // Learn Teams' worker channel from its own GraphQL traffic (services/cdl.ts),
  // so the overlay can send the same requests Teams' UI sends. Idempotent.
  installCdl();
  // Re-injecting a new build replaces the running one in place (no reload).
  const prev = window.__betterTeamsApp;
  if (prev) {
    if (prev.version === __BUILD__) {
      prev.show();
      return prev;
    }
    try {
      prev.destroy();
    } catch {
      document.getElementById(ROOT_ID)?.remove();
    }
  }
  ensureStyle();
  document.getElementById(PILL_ID)?.remove();
  const el = document.createElement("div");
  el.id = ROOT_ID;
  document.body.appendChild(el);

  // While the overlay is hidden, a small pill in Teams' title bar (left of the
  // native profile button) switches back. Lives outside #tc-root, so it is
  // styled inline; no-drag so the frameless title bar doesn't swallow clicks.
  const pill = document.createElement("button");
  pill.id = PILL_ID;
  pill.type = "button";
  Object.assign(pill.style, {
    position: "fixed",
    zIndex: "2147483000",
    height: "26px",
    padding: "0 12px",
    border: "0",
    borderRadius: "13px",
    background: "#4f6bed",
    color: "#fff",
    font: "600 12px/26px -apple-system, system-ui, sans-serif",
    cursor: "pointer",
    boxShadow: "0 1px 4px rgba(0,0,0,.25)",
    display: "none",
    whiteSpace: "nowrap",
  } as Partial<CSSStyleDeclaration>);
  pill.style.setProperty("-webkit-app-region", "no-drag");
  const placePill = (): void => {
    const t = document.querySelector<HTMLElement>('[data-tid="me-control-avatar-trigger"]');
    const r = t && t.getBoundingClientRect();
    if (r && r.width) {
      pill.style.top = Math.round(r.top + r.height / 2 - 13) + "px";
      pill.style.right = Math.round(window.innerWidth - r.left + 8) + "px";
    } else {
      pill.style.top = "8px";
      pill.style.right = "120px";
    }
  };

  let visible = true;
  let suppressed = false; // true while a call fills this window (see guard below)
  const hide = (): void => {
    el.style.display = "none";
    visible = false;
    if (!pill.isConnected) document.body.appendChild(pill);
    placePill();
    const quips = t().app.pill;
    pill.textContent = quips[Math.floor(Math.random() * quips.length)];
    pill.title = t().app.pillTitle;
    pill.style.display = "block";
  };
  const show = (): void => {
    ensureStyle();
    el.style.display = "grid";
    visible = true;
    pill.style.display = "none";
  };
  pill.addEventListener("click", () => show());
  window.addEventListener("resize", placePill);
  const toggle = (): void => {
    if (suppressed) return;
    if (visible) hide();
    else show();
  };

  const root = createRoot(el);
  root.render(<App onHide={hide} />);

  // Option+Cmd+T toggles the overlay.
  const onKey = (e: KeyboardEvent): void => {
    if (e.altKey && e.metaKey && (e.key === "t" || e.key === "T" || e.code === "KeyT")) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle();
    }
  };
  window.addEventListener("keydown", onKey, true);

  // Call-window guard: while this window shows an active call, fully suppress the
  // overlay AND the pill (the pill would still sit over the call's title bar), so
  // the native call UI — including video — is visible. When the call ends we
  // restore whatever state the overlay was in before. The ⌥⌘T toggle is a no-op
  // while suppressed. Poll (not just a MutationObserver) because Teams can mutate
  // the calling screen in place without a childList change we'd otherwise catch.
  let wasVisible = true;
  const applyGuard = (): void => {
    const inCall = isCallWindow();
    if (inCall === suppressed) return;
    if (inCall) {
      wasVisible = visible;
      suppressed = true;
      el.style.display = "none";
      pill.style.display = "none";
    } else {
      suppressed = false;
      if (wasVisible) show();
      else hide();
    }
  };
  applyGuard();
  const guardPoll = setInterval(applyGuard, 500);

  const destroy = (): void => {
    clearInterval(guardPoll);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", placePill);
    root.unmount();
    el.remove();
    pill.remove();
  };

  window.__betterTeamsApp = { show, hide, toggle, destroy, version: __BUILD__ };
  return window.__betterTeamsApp;
}

if (document.body) mount();
else window.addEventListener("DOMContentLoaded", mount);
