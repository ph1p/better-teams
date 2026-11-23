// In-memory backend for the mock build. Holds the fixture chats, applies every
// write the UI makes (send, edit, delete, react, read state, hide) and plays a
// small simulation on top: typing then a canned reply after you write in a chat,
// occasional background messages and presence drift. Subscribers (chat events,
// typing, presence) get pushed the same way Teams' worker would push them.
import type { Chat, FileRef, Message, Profile, Reaction } from "../types";
import { APPS, CHATS, CHATTER, ME, PEOPLE, PRESENCE, REPLIES, type SeedChat } from "./fixtures";
import { isAppMri } from "../apps";
import { shortName } from "../names";
import { extOf } from "../data/raw";
import { isOneToOneId } from "../data/state";

/** How many recent messages the first load shows; older ones page in on scroll. */
const WINDOW = 30;
const PAGE = 20;

interface MockChat {
  seed: SeedChat;
  /** A named group chat: can be renamed, and members added or removed. */
  group: boolean;
  messages: Message[];
  /** Read horizon, ms: anything newer from someone else is unread. */
  readMs: number;
  marked: boolean;
  hidden: boolean;
  muted?: boolean;
  left?: boolean;
  /** Channel notification preset (channels only). */
  preset?: string;
  favorite: boolean;
  pinned: boolean;
  liveCall?: string;
  /** Index of the oldest message the live window returns. */
  floor: number;
  /** Index the next older page ends at (reset when the chat is opened). */
  cursor: number;
}

const t0 = Date.now();
const at = (agoMin: number): number => t0 - agoMin * 60_000;
let idSeq = 0;
const nextId = (time: number): string => String(time) + String(++idSeq).padStart(3, "0");

export const profiles: Record<string, Profile> = {};
for (const { mri, ...p } of [...PEOPLE, ...APPS]) profiles[mri] = p;
export const nameOf = (mri: string): string => profiles[mri]?.displayName || "Unknown";

/** Who reacted with what, per message id; Message.reactions is derived from it. */
const reactors = new Map<string, Map<string, Set<string>>>();

function reactionsOf(id: string): Reaction[] {
  const byKey = reactors.get(id);
  if (!byKey) return [];
  const out: Reaction[] = [];
  for (const [key, users] of byKey) {
    if (users.size) out.push({ key, count: users.size, mine: users.has(ME) });
  }
  return out;
}

function makeMessage(from: string, html: string, time: number, extra: Partial<Message> = {}): Message {
  const id = nextId(time);
  return {
    id,
    rootId: id,
    rootTime: time,
    isReply: false,
    from: nameOf(from),
    fromMri: from,
    content: html,
    messageType: "RichText/Html",
    mine: from === ME,
    deleted: false,
    edited: false,
    subject: "",
    importance: "normal",
    reactions: [],
    files: [],
    time,
    ...extra,
  };
}

// A fake attachment: images get an SVG "photo" as their preview.
const PHOTO =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">` +
      `<defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="#7aa7e6"/><stop offset="1" stop-color="#f3c79b"/></linearGradient></defs>` +
      `<rect width="1200" height="800" fill="url(#g)"/><circle cx="900" cy="230" r="90" fill="#fff5d6"/>` +
      `<path d="M0 640 L300 380 L520 560 L760 330 L1200 700 L1200 800 L0 800Z" fill="#3d5a73"/></svg>`,
  );

function mockFile(name: string): FileRef {
  const ext = extOf(name);
  if (!/^(png|jpe?g|gif|webp)$/.test(ext)) return { name, url: "", ext };
  return { name, url: "", ext, preview: { url: PHOTO, width: 1200, height: 800 } };
}

const chats = new Map<string, MockChat>();
for (const seed of CHATS) {
  const messages: Message[] = [];
  for (const s of seed.messages) {
    const time = at(s.ago);
    const root = s.replyTo !== undefined ? messages[s.replyTo] : undefined;
    const m = makeMessage(s.from, s.html, time, {
      edited: !!s.edited,
      subject: s.subject || "",
      importance: s.importance || "normal",
      files: (s.files || []).map(mockFile),
      ...(s.type ? { messageType: s.type } : {}),
      ...(s.call ? { call: s.call } : {}),
      ...(root ? { rootId: root.id, rootTime: root.rootTime, isReply: true } : {}),
    });
    if (s.reactions) {
      reactors.set(m.id, new Map(Object.entries(s.reactions).map(([k, users]) => [k, new Set(users)])));
    }
    messages.push(m);
  }
  chats.set(seed.id, {
    seed,
    messages,
    group: seed.kind === "chat" && !isOneToOneId(seed.id),
    readMs: at(seed.readAgo ?? 0) + 1,
    marked: false,
    hidden: !!seed.hidden,
    favorite: !!seed.favorite,
    pinned: !!seed.pinned,
    ...(seed.liveCall !== undefined ? { liveCall: messages[seed.liveCall].id } : {}),
    floor: Math.max(0, messages.length - WINDOW),
    cursor: Math.max(0, messages.length - WINDOW),
  });
}

export const getChat = (id: string): MockChat | undefined => chats.get(id);
const withReactions = (m: Message): Message => ({ ...m, reactions: reactionsOf(m.id) });

function sortThread(list: Message[], channel: boolean): Message[] {
  if (!channel) return [...list].sort((a, b) => a.time - b.time);
  return [...list].sort((a, b) => a.rootTime - b.rootTime || Number(a.isReply) - Number(b.isReply) || a.time - b.time);
}

// --- Subscriptions ---------------------------------------------------------

type ChatEventCb = (convId: string, type: string, messageId?: string) => void;
const chatSubs = new Set<ChatEventCb>();
export function onChatEvent(cb: ChatEventCb): () => void {
  chatSubs.add(cb);
  return () => chatSubs.delete(cb);
}

// The UI re-reads on DOM changes outside its root (ui/lib/live.ts), which is
// how it notices Teams' own writes. Touch a hidden node to give it that cue.
let beacon: HTMLElement | null = null;
function poke(): void {
  if (!beacon) {
    beacon = document.createElement("div");
    beacon.hidden = true;
    beacon.id = "tc-mock-beacon";
    document.body.appendChild(beacon);
  }
  beacon.textContent = String(Date.now());
}

function emit(convId: string, type: string, messageId?: string): void {
  for (const cb of chatSubs) cb(convId, type, messageId);
  poke();
}

type TypingCb = (convId: string, users: string[]) => void;
const typingSubs = new Set<TypingCb>();
const typingNow = new Map<string, string[]>();
export function onTyping(cb: TypingCb): () => void {
  typingSubs.add(cb);
  return () => typingSubs.delete(cb);
}
export const typingIn = (convId: string): string[] => typingNow.get(convId) || [];
function setTyping(convId: string, users: string[]): void {
  typingNow.set(convId, users);
  for (const cb of typingSubs) cb(convId, users);
}

type PresenceCb = (mri: string, availability: string) => void;
const presenceSubs = new Set<PresenceCb>();
export const presence: Record<string, string> = { ...PRESENCE };
export function onPresence(cb: PresenceCb): () => void {
  presenceSubs.add(cb);
  return () => presenceSubs.delete(cb);
}
export function setPresence(mri: string, availability: string): void {
  presence[mri] = availability;
  for (const cb of presenceSubs) cb(mri, availability);
}

// --- Reads -----------------------------------------------------------------

export function listChats(): Chat[] {
  const out: Chat[] = [];
  for (const c of chats.values()) {
    const { seed } = c;
    const last = c.messages[c.messages.length - 1];
    const time = last ? last.time : t0;
    const others = seed.members.filter((m) => m !== ME);
    const names = others.map(nameOf);
    const title =
      seed.kind === "notes"
        ? "Notes"
        : seed.topic ||
          (names.length === 1
            ? names[0]
            : names
                .slice(0, 3)
                .map((_, i) => shortName(profiles[others[i]] ?? { displayName: names[i] }))
                .join(", "));
    const nameTitle = (seed.kind === "chat" || seed.kind === "meeting") && !seed.topic && others.length > 0;
    const lastFromMe = !!last && last.fromMri === ME;
    // A message newer than the hide time brings a hidden chat back, as in Teams.
    out.push({
      ...(c.liveCall ? { liveCall: c.liveCall } : {}),
      id: seed.id,
      kind: seed.kind,
      title,
      ...(nameTitle ? { nameTitle: true } : {}),
      team: seed.team || "",
      isChannel: seed.kind === "channel",
      avatarMri: seed.kind === "chat" && others.length === 1 ? others[0] : "",
      members: others,
      app: seed.kind === "chat" && others.length === 1 && isAppMri(others[0]),
      favorite: c.favorite,
      pinned: c.pinned,
      hidden: c.hidden,
      muted: !!c.muted,
      group: c.group,
      left: !!c.left,
      time,
      unread: c.marked || (!lastFromMe && time > c.readMs),
      last: {
        from: lastFromMe ? "You" : last ? last.from : "",
        content: last ? (last.deleted ? "" : last.content) : "",
        type: last ? last.messageType : "",
      },
    });
  }
  return out.sort((a, b) => b.time - a.time);
}

/** The live window: everything from the initial floor on, so new messages accumulate. */
export function recent(convId: string): Message[] | null {
  const c = chats.get(convId);
  if (!c) return null;
  return sortThread(c.messages.slice(c.floor).map(withReactions), c.seed.kind === "channel");
}

export function resetPaging(convId: string): void {
  const c = chats.get(convId);
  if (c) c.cursor = c.floor;
}

/** Next older page, or null at the start of history. */
export function older(convId: string): Message[] | null {
  const c = chats.get(convId);
  if (!c || c.cursor <= 0) return null;
  const from = Math.max(0, c.cursor - PAGE);
  const page = c.messages.slice(from, c.cursor).map(withReactions);
  c.cursor = from;
  return sortThread(page, c.seed.kind === "channel");
}

// --- Writes ----------------------------------------------------------------

function find(convId: string, messageId: string): { c: MockChat; m: Message } | null {
  const c = chats.get(convId);
  const m = c?.messages.find((x) => x.id === messageId);
  return c && m ? { c, m } : null;
}

export function post(
  convId: string,
  from: string,
  html: string,
  rootId?: string,
  files: FileRef[] = [],
): Message | null {
  const c = chats.get(convId);
  if (!c) return null;
  const time = Date.now();
  const root = rootId ? c.messages.find((m) => m.id === rootId) : undefined;
  const m = makeMessage(from, html, time, {
    files,
    ...(root ? { rootId: root.id, rootTime: root.rootTime, isReply: true } : {}),
  });
  c.messages.push(m);
  if (from === ME) {
    c.readMs = time + 1;
    c.marked = false;
  }
  if (time > c.readMs || from === ME) c.hidden = false;
  emit(convId, "NewMessage", m.id);
  if (from === ME) scheduleReply(c, root?.id);
  return m;
}

export function edit(convId: string, messageId: string, html: string): boolean {
  const hit = find(convId, messageId);
  if (!hit || !hit.m.mine) return false;
  hit.m.content = html;
  hit.m.edited = true;
  emit(convId, "MessageUpdate", messageId);
  return true;
}

export function setFiles(convId: string, messageId: string, files: FileRef[]): boolean {
  const hit = find(convId, messageId);
  if (!hit || !hit.m.mine) return false;
  hit.m.files = files;
  emit(convId, "MessageUpdate", messageId);
  return true;
}

export function setDeleted(convId: string, messageId: string, deleted: boolean): boolean {
  const hit = find(convId, messageId);
  if (!hit || !hit.m.mine) return false;
  hit.m.deleted = deleted;
  emit(convId, deleted ? "MessageRemoved" : "MessageUpdate", messageId);
  return true;
}

export function react(convId: string, messageId: string, key: string, add: boolean, who = ME): boolean {
  if (!find(convId, messageId)) return false;
  let byKey = reactors.get(messageId);
  if (!byKey) reactors.set(messageId, (byKey = new Map()));
  let users = byKey.get(key);
  if (!users) byKey.set(key, (users = new Set()));
  if (add) users.add(who);
  else users.delete(who);
  emit(convId, "MessageUpdate", messageId);
  return true;
}

export function setRead(convId: string, read: boolean): boolean {
  const c = chats.get(convId);
  if (!c) return false;
  if (read) {
    const last = c.messages[c.messages.length - 1];
    c.readMs = Math.max(Date.now(), last ? last.time + 1 : 0);
    c.marked = false;
  } else {
    c.marked = true;
  }
  return true;
}

export function setHidden(convId: string, hidden: boolean): boolean {
  const c = chats.get(convId);
  if (!c) return false;
  c.hidden = hidden;
  return true;
}

/** Group chat management, as the worker's resolvers do it. */
export function setTopic(convId: string, topic: string): boolean {
  const c = chats.get(convId);
  if (!c?.group && c?.seed.kind !== "channel") return false;
  c.seed.topic = topic;
  poke();
  return true;
}

export function setMembers(convId: string, add: string[], remove: string[]): boolean {
  const c = chats.get(convId);
  if (!c?.group) return false;
  c.seed.members = [...new Set([...c.seed.members.filter((m) => !remove.includes(m)), ...add])];
  if (remove.includes(ME)) {
    c.left = true;
    c.hidden = true;
  }
  poke();
  return true;
}

export function setMuted(convId: string, muted: boolean): boolean {
  const c = chats.get(convId);
  if (!c || c.seed.kind === "channel") return false;
  c.muted = muted;
  poke();
  return true;
}

export function channelPreset(convId: string, preset?: string): string | null {
  const c = chats.get(convId);
  if (!c || c.seed.kind !== "channel") return null;
  if (preset) c.preset = preset;
  return c.preset || "ALL_NEW_MSGS";
}

/** A channel's members; with `add`/`remove` changes them first. Null for no channel. */
export function channelMembers(convId: string, add: string[] = [], remove: string[] = []): string[] | null {
  const c = chats.get(convId);
  if (!c || c.seed.kind !== "channel") return null;
  if (add.length || remove.length) {
    c.seed.members = [...new Set([...c.seed.members.filter((m) => !remove.includes(m)), ...add])];
    poke();
  }
  return c.seed.members;
}

/** Leave a channel, or with `team` every channel of its team. */
export function leaveChannel(convId: string, team: boolean): boolean {
  const c = chats.get(convId);
  if (!c || c.seed.kind !== "channel") return false;
  for (const [id, x] of chats) {
    if (id === convId || (team && x.seed.kind === "channel" && x.seed.team === c.seed.team)) chats.delete(id);
  }
  poke();
  return true;
}

/** Add a channel to the team of channel `convId`; its id, or "" for no team. */
export function addChannel(convId: string, topic: string, isPrivate: boolean): string {
  const c = chats.get(convId);
  if (!c || c.seed.kind !== "channel") return "";
  const id = `19:mock-${isPrivate ? "private-" : ""}${Date.now().toString(36)}@thread.tacv2`;
  const seed: SeedChat = { id, kind: "channel", topic, team: c.seed.team, members: [...c.seed.members], messages: [] };
  chats.set(id, {
    seed,
    group: false,
    messages: [],
    readMs: Date.now(),
    marked: false,
    hidden: false,
    favorite: false,
    pinned: false,
    floor: 0,
    cursor: 0,
  });
  poke();
  return id;
}

/** The 1:1 or group chat with exactly these people, created if there is none yet. */
export function chatWith(mris: string[]): string {
  const want = [...new Set(mris.filter((m) => m && m !== ME))].sort().join(",");
  for (const c of chats.values()) {
    if (c.seed.kind === "chat" && !c.group && [...c.seed.members].sort().join(",") === want) return c.seed.id;
  }
  const id = `19:mock-${Date.now().toString(36)}@unq.gbl.spaces`;
  const seed: SeedChat = { id, kind: "chat", members: want.split(","), messages: [] };
  chats.set(id, {
    seed,
    group: false,
    messages: [],
    readMs: Date.now(),
    marked: false,
    hidden: false,
    favorite: false,
    pinned: false,
    floor: 0,
    cursor: 0,
  });
  return id;
}

// --- Simulation ------------------------------------------------------------

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** After I write in a chat (not a channel), someone in it types, then answers. */
function scheduleReply(c: MockChat, rootId?: string): void {
  if (c.seed.kind === "notes") return;
  const others = c.seed.members.filter((m) => m !== ME);
  if (!others.length) return;
  const who = pick(others);
  if (isAppMri(who)) {
    setTimeout(() => post(c.seed.id, who, "<p>Sorry, I didn't get that. Try <b>help</b>.</p>", rootId), 700);
    return;
  }
  const convId = c.seed.id;
  const channel = c.seed.kind === "channel";
  // Channels only answer in threads; a new top-level post stays quiet.
  if (channel && !rootId) return;
  setTimeout(
    () => {
      if (!channel) setTyping(convId, [who]);
      setTimeout(
        () => {
          if (!channel) setTyping(convId, []);
          post(convId, who, `<p>${pick(REPLIES)}</p>`, rootId);
        },
        1800 + Math.random() * 1500,
      );
    },
    900 + Math.random() * 800,
  );
}

let started = false;
/** Background life: a stray message every ~45 s and presence drift every ~20 s. */
export function startSimulation(): void {
  if (started) return;
  started = true;
  setInterval(() => {
    const candidates = [...chats.values()].filter(
      (c) => c.seed.kind === "chat" && c.seed.members.length && !c.seed.members.some(isAppMri),
    );
    const c = pick(candidates);
    post(c.seed.id, pick(c.seed.members), `<p>${pick(CHATTER)}</p>`);
  }, 45_000);
  const states = ["Available", "Busy", "Away", "BeRightBack", "DoNotDisturb"];
  setInterval(() => {
    const p = pick(PEOPLE.filter((x) => x.mri !== ME));
    setPresence(p.mri, pick(states));
  }, 20_000);
}
