// Service layer: the one place the overlay talks to Teams' backends.
//
// Preferred transport: cdl.ts. It posts the same GraphQL envelopes Teams' UI
// posts to its web worker; the worker authenticates and calls the backend, so
// no token is needed and it works in prod (docs/cdl-api.md). Used for presence
// (set and watch), status note, the chat message list, chat writes (send, edit, delete,
// react, read/unread, hide), group chat management
// (rename, members, leave, mute, channel notifications) and the typing indicator (send and subscribe).
//
// Legacy transport: http.call(). it attaches the bearer Teams itself uses
// for that backend (passively captured, auth.ts) and refuses any host outside
// the Microsoft allowlist. Nothing is sent anywhere Teams would not send it.
//
// Coverage note (Nov 2026): mt (aud api.spaces.skype.com), csa (chatsvcagg),
// presence (ups) and most chatsvc calls run inside Teams' web worker, so their
// bearers never cross the page's fetch/XHR. auth.ts asks Teams' page auth
// handler for those (the one the worker itself uses, via cdl.ts cdlToken).
// SubstrateSearch is captured in-page only. In dev, scripts/presence-bridge.ts
// also files the workers' own request headers into the vault (__tcAuthIngest).

export { cdl, cdlReady, cdlSubscribe, installCdl, whenCdl, type CdlRes } from "./cdl";
export * as chat from "./chat";
export * as chatsvc from "./chatsvc";
export * as groups from "./groups";
export * as presence from "./presence";
export * as substrate from "./substrate";
export * as typing from "./typing";
export {
  authStatus,
  ingestAuthHeader,
  installAuthCapture,
  myOid,
  region,
  token,
  whenToken,
  type Audience,
} from "./auth";
export { allowedUrl, call, type CallOptions, type Res } from "./http";
