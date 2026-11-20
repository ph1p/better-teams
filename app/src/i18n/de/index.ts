// German. Each area is typed against the English one (../en), so tsc flags a
// missing, extra or differently-shaped string. Teams' own German terms where
// they exist; the user is addressed with "du".
import type { Messages } from "../en";
import { common } from "./common";
import { sidebar } from "./sidebar";
import { chat } from "./chat";
import { composer } from "./composer";
import { app } from "./app";

export const de: Messages = { common, sidebar, chat, composer, app };
