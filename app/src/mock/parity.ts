// Compile-time check that every mock module exports the same values, with the
// same types, as the real module it stands in for. Never imported at runtime:
// `npm run typecheck` fails here when a real export changes and its mock lags.
import type * as RealData from "../teamsData";
import type * as RealSend from "../send";
import type * as RealChat from "../services/chat";
import type * as RealTyping from "../services/typing";
import type * as RealPresence from "../services/presence";
import * as Data from "./teamsData";
import * as Send from "./send";
import * as Chat from "./services/chat";
import * as Typing from "./services/typing";
import * as Presence from "./services/presence";

export const parity: [typeof RealData, typeof RealSend, typeof RealChat, typeof RealTyping, typeof RealPresence] = [
  Data,
  Send,
  Chat,
  Typing,
  Presence,
];
