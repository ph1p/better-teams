// Chat list: Teams' conversation store -> sidebar rows.
import type { Chat, ChatKind, WriteResult } from "../types";
import { chat } from "../services";
import { isAppMri } from "../apps";
import { getAll, myMri, open } from "./idb";
import { shortName } from "../names";
import { profile } from "./profiles";
import { arr, get, mriOf, obj, parsed, str, toMs, type Dict } from "./raw";
import { effectiveShown, isDeparted, withPending } from "./groups";
import { effectiveHidden, effectiveHorizon, effectiveMarked, flushPendingHorizons } from "./readState";
import { isOneToOneId, lastByConv } from "./state";

// Teams conversation types we show, mapped to our sections.
const KIND: Record<string, ChatKind> = {
  Chat: "chat",
  Meeting: "meeting",
  Topic: "channel",
  StreamOfNotes: "notes",
};

// No topic and at least one named member: the title is built from member names.
function isNameTitle(c: Dict, kind: ChatKind, others: string[]) {
  if (kind !== "chat" && kind !== "meeting") return false;
  if (str(obj(c.threadProperties).topic)) return false;
  return others.some((m) => profile(m).displayName);
}

function chatTitle(c: Dict, kind: ChatKind, others: string[]) {
  const tp = obj(c.threadProperties);
  if (kind === "notes") return "Notes";
  if (kind === "channel") {
    // The General channel often has no topic of its own.
    // Private/shared channels are their own space: spaceThreadTopic is their name.
    if (str(c.type) === "Space" && str(c.id) !== str(c.teamId)) return str(tp.spaceThreadTopic) || "Channel";
    return str(tp.topic) || str(tp.topicThreadTopic) || "General";
  }
  if (str(tp.topic)) return str(tp.topic);
  const names = others.map((m) => profile(m)).filter((p) => p.displayName);
  if (names.length === 1) return names[0].displayName;
  if (names.length > 1) {
    const shown = names.slice(0, 3).map(shortName).join(", ");
    return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
  }
  const lm = obj(c.lastMessage);
  if (str(lm.imdisplayname) && mriOf(lm.from) !== myMri()) return str(lm.imdisplayname);
  return kind === "meeting" ? "Meeting chat" : "(Chat)";
}

// Teams' real favorites live in the conversation-folder-manager DB, in a folder
// with folderType "Favorites" (pinned chats were migrated into it). The old
// properties.favorite flag on a conversation is only set for channels, not
// chats, so reading it alone made the overlay disagree with Teams. Returns the
// folder's id and its conversation ids; empty on any failure (favorites are
// optional).
async function favoritesFolder() {
  const ids = new Set<string>();
  try {
    const db = await open("conversation-folder");
    const folders = await getAll(db, "folders", 200);
    const fav = folders.map(obj).find((f) => f.folderType === "Favorites" && !f.isDeleted);
    for (const c of arr(fav && fav.conversations)) {
      const id = str(get(c, "id"));
      if (id) ids.add(id);
    }
    return { id: str(fav && fav.id), ids };
  } catch {
    return { id: "", ids };
  }
}

// Local favorite overrides: what we last set, held until the folder in Teams'
// IndexedDB agrees (the worker writes it a moment after the mutation answers).
const favOverride = new Map<string, boolean>();

function effectiveFavorite(conversationId: string, idbFav: boolean) {
  const ov = favOverride.get(conversationId);
  if (ov === undefined) return idbFav;
  if (ov === idbFav) favOverride.delete(conversationId);
  return ov;
}

// Teams' Favorites sync to all clients.
export async function setChatFavorite(conversationId: string, fav: boolean): Promise<WriteResult> {
  const { id } = await favoritesFolder();
  if (!id) return { ok: false, reason: "no Favorites folder" };
  const r = await chat.setChatFavorite(conversationId, fav, id);
  if (!r.ok) return r;
  favOverride.set(conversationId, fav);
  return { ok: true, via: "cdl" };
}

// Chat requests: someone outside your contacts wrote first. Teams keeps the
// chat hidden until you accept it (consumer: interopconversationstatus;
// enterprise: conversationstatus AcceptPendingRecipient).
const PENDING = new Set(["AcceptPending", "ExtendedDirectoryAcceptPending"]);
function isRequest(props: Dict) {
  return PENDING.has(str(props.interopconversationstatus)) || props.conversationstatus === "AcceptPendingRecipient";
}

// Our answer to a request, held while IndexedDB still says pending.
const requestOverride = new Map<string, "Accept" | "Block">();

// Block also hides the chat.
export async function answerChatRequest(c: Chat, action: "Accept" | "Block"): Promise<WriteResult> {
  const r = await chat.answerChatRequest(c.id, c.inviter ?? "", action);
  if (!r.ok) return r;
  requestOverride.set(c.id, action);
  return { ok: true, via: "cdl" };
}

// Running call: Teams keeps "awareness_conversationLiveState:<rootId>" in the
// thread properties (JSON: status, expiration in s). A call whose end event got
// lost stays "Active" but expires, so expiration is checked too.
function liveCallRoot(tp: Dict) {
  const now = Date.now();
  for (const [k, v] of Object.entries(tp)) {
    if (!k.startsWith("awareness_conversationLiveState:")) continue;
    const j = obj(parsed(v));
    if (j.status === "Active" && Number(j.expiration) * 1000 > now) return k.slice(k.indexOf(":") + 1);
  }
  return "";
}

function hasLeft(tp: Dict) {
  return (Number(tp.lastleaveat) || 0) > (Number(tp.lastjoinat) || 0);
}

export async function listChats() {
  void flushPendingHorizons();
  const db = await open("conversation");
  const rows = (await getAll(db, "conversations", 10000)).map(obj);
  const favs = (await favoritesFolder()).ids;
  const spaces: Record<string, Dict> = {};
  for (const c of rows) if (c.type === "Space") spaces[str(c.id)] = c;
  const me = myMri();

  const chats: Chat[] = [];
  for (const c of rows) {
    // Channels stored as "Space" rows: a team's General channel is the team's
    // own row (id === teamId, topic "General"); private/shared channels are
    // their own space (id !== teamId, threadSubType PrivateChannel/…), named by
    // spaceThreadTopic. "lwgChannelLie-*" rows are Teams' optimistic
    // placeholders for a channel being created; the real row follows.
    const tp = obj(c.threadProperties);
    const isSpaceChannel = c.type === "Space" && !!c.id && !!c.teamId && !obj(c.properties).isLie;
    const kind = isSpaceChannel ? "channel" : KIND[str(c.type)];
    if (!kind || !c.id) continue;
    if (tp.isdeleted === "true" || tp.isdeleted === true) continue;
    // A brand-new channel has no message yet; list it from its creation time.
    // Notes (chat with yourself) may be empty too and always stay listed.
    if (!c.lastMessage && kind !== "channel" && kind !== "notes") continue;
    const props = obj(c.properties);
    const lm = obj(c.lastMessage);
    const time =
      toMs(c.lastMessageTimeUtc) ||
      toMs(lm.originalarrivaltime) ||
      toMs(lm.composetime) ||
      (kind === "channel" ? toMs(tp.createdat) : 0);
    if (!time && kind !== "notes") continue;
    const lmTime = toMs(lm.originalarrivaltime) || time;
    if (lm.id) lastByConv.set(str(c.id), { id: String(lm.id), clientMessageId: str(lm.clientmessageid), time: lmTime });

    const others = arr(c.members)
      .map((m) => str(get(m, "id")) || str(get(m, "mri")))
      .filter((id) => id && id !== me);
    const teamKey = str(c.teamId) || str(tp.spaceId);
    const team = kind === "channel" ? spaces[teamKey] : undefined;
    const teamTp = obj(team && team.threadProperties);
    const teamName = team ? str(teamTp.spaceThreadTopic) || str(teamTp.topic) : "";
    const lastFromMe = mriOf(lm.from) === me;
    // Read pointer = consumptionhorizon field 0 ("<msgId>;<ms>;<id>"). Checked
    // against Teams' own threadProperties.isRead: matches on all 250 chats, while
    // also honouring consumptionHorizonBookmark does not.
    const horizon = effectiveHorizon(str(c.id), toMs(String(props.consumptionhorizon ?? "").split(";")[0]));
    // A thread we left (lastleaveat after lastjoinat) keeps a stale horizon that
    // read writes can't move (we're no longer a member), so it would show unread
    // forever, even right after marking it read.
    const left = hasLeft(tp);
    // A team we left keeps its channel rows (General is the team's own row),
    // but chatsvc refuses them with 403 AclCheckFailed, so they could never
    // load. Teams no longer lists them either.
    if (kind === "channel" && (left || (team && hasLeft(teamTp)) || isDeparted(str(c.id), teamKey))) continue;
    // Hidden channel (Teams' channel "Hide"): Teams lists a channel only while
    // its favorite property is "true"; a missing one counts as shown. General
    // stays listed when hidden (in italics); the others drop out of the
    // sidebar (sections.ts listed) but stay in the list, so the team's
    // show/hide menu can bring them back.
    const general = kind === "channel" && c.id === teamKey;
    // Private and shared channels are their own Space row (General is the
    // team's); the sub-type (PrivateChannel / SharedChannel) tells them apart.
    const subType = str(tp.threadSubType) || str(tp.threadsubtype) || str(c.threadSubType);
    const channelType =
      kind === "channel" && c.type === "Space" && !general
        ? /shared/i.test(subType)
          ? ("shared" as const)
          : ("private" as const)
        : undefined;
    const channelHidden =
      kind === "channel" &&
      !effectiveShown(str(c.id), props.favorite == null || String(props.favorite).toLowerCase() === "true");
    // Hidden (Teams' "Hide"): the worker keeps the hide time in the user
    // property unpinnedTime; a newer message brings the chat back.
    const hiddenAt = Number(props.unpinnedTime) || 0;
    let hidden = effectiveHidden(str(c.id), hiddenAt > 0 && time <= hiddenAt);
    let request = isRequest(props);
    const answer = requestOverride.get(str(c.id));
    if (answer && !request) requestOverride.delete(str(c.id));
    if (answer) request = false;
    // A request is hidden in Teams until answered; we list it in its own section.
    if (request || answer === "Accept") hidden = false;
    if (answer === "Block" || props.interopconversationstatus === "Blocked") hidden = true;

    chats.push(
      withPending(str(c.id), {
        ...(liveCallRoot(tp) ? { liveCall: liveCallRoot(tp) } : {}),
        id: str(c.id),
        kind,
        title: chatTitle(c, kind, others),
        ...(isNameTitle(c, kind, others) ? { nameTitle: true } : {}),
        team: teamName,
        isChannel: kind === "channel",
        ...(kind === "channel"
          ? {
              teamId: teamKey,
              ...(general ? { general } : {}),
              ...(channelHidden ? { channelHidden } : {}),
              ...(channelType ? { channelType } : {}),
            }
          : {}),
        avatarMri: kind === "chat" && others.length === 1 ? others[0] : "",
        // Other participants' MRIs — powers the "chats with this user" panel.
        members: others,
        app: kind === "chat" && others.length === 1 && isAppMri(others[0]),
        favorite: effectiveFavorite(str(c.id), favs.has(str(c.id))),
        pinned: props.ispinned === "true" || props.ispinned === true,
        hidden,
        // The worker's setMuteChat writes the conversation property alerts = String(!mute).
        muted: kind !== "channel" && (props.alerts === "false" || props.alerts === false),
        group:
          kind === "chat" &&
          !isOneToOneId(str(c.id)) &&
          tp.uniquerosterthread !== "true" &&
          tp.uniquerosterthread !== true,
        left,
        time,
        ...(request ? { request: true, inviter: str(tp.creator) || others[0] || "" } : {}),
        unread:
          !left && !request && (effectiveMarked(str(c.id), props) || (!lastFromMe && horizon > 0 && time > horizon)),
        last: {
          from: lastFromMe ? "You" : str(lm.imdisplayname),
          content: str(lm.content),
          type: str(lm.messagetype),
        },
      }),
    );
  }
  chats.sort((a, b) => b.time - a.time);
  return chats;
}
