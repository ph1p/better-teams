// English, the source language. Each area file is one top-level key; the
// German files (../de) are typed against this shape.
import { common } from "./common";
import { sidebar } from "./sidebar";
import { chat } from "./chat";
import { composer } from "./composer";
import { app } from "./app";

export const en = { common, sidebar, chat, composer, app };
export type Messages = typeof en;
