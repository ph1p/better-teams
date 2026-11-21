// Chat list: Teams' conversation store -> sidebar rows.
import type { Chat, ChatKind } from "../types";
import { isAppMri } from "../apps";
import { getAll, myMri, open } from "./idb";
import { profile } from "./profiles";
import { arr, get, mriOf, obj, str, toMs, type Dict } from "./raw";
import { isDeparted, withPending } from "./groups";
import { effectiveHidden, effectiveHorizon, effectiveMarked, flushPendingHorizons } from "./readState";
import { isOneToOneId, lastByConv } from "./state";

// Teams conversation types we show, mapped to our sections.
const KIND: Record<string, ChatKind> = {
  Chat: "chat", Meeting: "meeting", Topic: "channel", StreamOfNotes: "notes",
};

const firstName = (n: string): string => n.split(/[\s,]+/)[0];

function chatTitle(c: Dict, kind: ChatKind, others: string[]): string {
  const tp = obj(c.threadProperties);
  if (kind === "notes") return "Notes";
  if (kind === "channel") {
    // The General channel often has no topic of its own.
    // Private/shared channels are their own space: spaceThreadTopic is their name.
    if (str(c.type) === "Space" && str(c.id) !== str(c.teamId)) return str(tp.spaceThreadTopic) || "Channel";
    return str(tp.topic) || str(tp.topicThreadTopic) || "General";
  }
  if (str(tp.topic)) return str(tp.topic);
  const names = others.map((m) => profile(m).displayName).filter(Boolean);
  if (names.length === 1) return names[0];
  if (names.length > 1) {
    const shown = names.slice(0, 3).map(firstName).join(", ");
    return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
  }
  const lm = obj(c.lastMessage);
  if (str(lm.imdisplayname) && mriOf(lm.from) !== myMri()) return str(lm.imdisplayname);
  return kind === "meeting" ? "Meeting chat" : "(Chat)";
}

// Teams' real favorites live in the conversation-folder-manager DB, in a folder
// with folderType "Favorites" (pinned chats were migrated into it). The old
// properties.favorite flag on a conversation is only set for channels, not
// chats, so reading it alone made the overlay disagree with Teams. Returns a Set
// of favorited conversation ids; empty on any failure (favorites are optional).
async function favoriteIds(): Promise<Set<string>> {
  try {
    const db = await open("conversation-folder");
    const folders = await getAll(db, "folders", 200);
    const fav = folders.map(obj).find((f) => f.folderType === "Favorites" && !f.isDeleted);
    const ids = new Set<string>();
    for (const c of arr(fav && fav.conversations)) {
      const id = str(get(c, "id"));
      if (id) ids.add(id);
    }
    return ids;
  } catch {
    return new Set<string>();
  }
}

// Running call: Teams keeps "awareness_conversationLiveState:<rootId>" in the
// thread properties (JSON: status, expiration in s). A call whose end event got
// lost stays "Active" but expires, so expiration is checked too.
function liveCallRoot(tp: Dict): string {
  const now = Date.now();
  for (const [k, v] of Object.entries(tp)) {
    if (!k.startsWith("awareness_conversationLiveState:")) continue;
    let j: Dict;
    try { j = obj(typeof v === "string" ? JSON.parse(v) : v); } catch { continue; }
    if (j.status === "Active" && Number(j.expiration) * 1000 > now) return k.slice(k.indexOf(":") + 1);
  }
  return "";
}

/** Left the thread: its last leave is newer than its last join. */
function hasLeft(tp: Dict): boolean {
  return (Number(tp.lastleaveat) || 0) > (Number(tp.lastjoinat) || 0);
}

export async function listChats(): Promise<Chat[]> {
  void flushPendingHorizons();
  const db = await open("conversation");
  const rows = (await getAll(db, "conversations", 10000)).map(obj);
  const favs = await favoriteIds();
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
    if (!c.lastMessage && kind !== "channel") continue;
    const props = obj(c.properties);
    const lm = obj(c.lastMessage);
    const time = toMs(c.lastMessageTimeUtc) || toMs(lm.originalarrivaltime) || toMs(lm.composetime)
      || (kind === "channel" ? toMs(tp.createdat) : 0);
    if (!time) continue;
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
    // Hidden standard channel (Teams' "Hide"): Teams lists a channel other
    // than General only while its favorite property is "true". A missing one
    // is kept, to stay on the safe side.
    if (kind === "channel" && c.id !== teamKey && props.favorite != null && String(props.favorite).toLowerCase() !== "true") continue;
    // Hidden (Teams' "Hide"): the worker keeps the hide time in the user
    // property unpinnedTime; a newer message brings the chat back.
    const hiddenAt = Number(props.unpinnedTime) || 0;
    const hidden = effectiveHidden(str(c.id), hiddenAt > 0 && time <= hiddenAt);

    chats.push(withPending(str(c.id), {
      ...(liveCallRoot(tp) ? { liveCall: liveCallRoot(tp) } : {}),
      id: str(c.id),
      kind,
      title: chatTitle(c, kind, others),
      team: teamName,
      isChannel: kind === "channel",
      // 1:1 chats get the other person's photo.
      avatarMri: kind === "chat" && others.length === 1 ? others[0] : "",
      // Other participants' MRIs — powers the "chats with this user" panel.
      members: others,
      app: kind === "chat" && others.length === 1 && isAppMri(others[0]),
      favorite: favs.has(str(c.id)),
      pinned: props.ispinned === "true" || props.ispinned === true,
      hidden,
      // The worker's setMuteChat writes the conversation property alerts = String(!mute).
      muted: kind !== "channel" && (props.alerts === "false" || props.alerts === false),
      // Everything of kind chat that isn't 1:1 is a group chat.
      group: kind === "chat" && !isOneToOneId(str(c.id))
        && tp.uniquerosterthread !== "true" && tp.uniquerosterthread !== true,
      left,
      time,
      unread: !left && (effectiveMarked(str(c.id), props) || (!lastFromMe && horizon > 0 && time > horizon)),
      last: {
        from: lastFromMe ? "You" : str(lm.imdisplayname),
        content: str(lm.content),
        type: str(lm.messagetype),
      },
    }));
  }
  chats.sort((a, b) => b.time - a.time);
  return chats;
}
