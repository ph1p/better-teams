import { useLatest } from "../lib/latest";
import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import {
  addChannelMembers,
  addChatMembers,
  createChannel,
  deleteChannel,
  getChannelActions,
  leaveChannel,
  leaveChat,
  leaveTeam,
  markRead,
  markUnread,
  myMri,
  profile,
  removeChatMember,
  renameChat,
  sendRemote,
  setChatFavorite,
  setChatHidden,
  setChatMuted,
  type PeopleHit,
} from "../../teamsData";
import {
  joinNativeMeeting,
  openNativeNewChat,
  sendMessage,
  sendNativeDraft,
  startNativeCall,
  startNativeChannelMeeting,
  type PickPerson,
} from "../../send";
import type { NewChatOutcome } from "../sidebar/NewChat";
import type { Flash } from "../lib/toast";
import type { Chat, WriteResult } from "../../types";
import { t } from "../../i18n";

// New chat dialog: null = closed. `draft` = Teams already shows an empty new
// chat with exactly `people` (so the dialog asks for the first message).
export type NewChatState = null | { people: PeopleHit[]; draft: boolean };

interface Deps {
  sel: string | null;
  chatsRef: MutableRefObject<Chat[]>;
  setChats: Dispatch<SetStateAction<Chat[]>>;
  pick: (id: string) => void;
  flash: Flash;
}

// Resolve a person's UPN (email) for Teams deep links.
const upnOf = (mri: string): string => {
  const p = profile(mri);
  return p.email || (String(mri || "").match(/[^:]+@[^:]+/) || [""])[0];
};

const toPick = (p: PeopleHit): PickPerson => ({
  upn: p.email || upnOf(p.mri),
  oid: (String(p.mri || "").match(/^8:orgid:([0-9a-f-]{36})$/i) || ["", ""])[1],
});

// Chat-level actions that go through Teams: new chats, calls and meetings,
// read state and hiding. Writes are optimistic and revert on failure.
export function useChatActions({ sel, chatsRef, setChats, pick, flash }: Deps) {
  const selRef = useLatest(sel);
  const [newChat, setNewChat] = useState<NewChatState>(null);
  // Add channel dialog: the channel whose team gets the new one; null = closed.
  const [newChannel, setNewChannel] = useState<Chat | null>(null);

  // Select a chat once our list knows it. A chat Teams just created only shows
  // up after the next poll picks it out of Teams' local store.
  // `id` may also be a match, for a chat whose id we don't know yet.
  const pickWhenListed = useCallback(
    async (id: string | ((c: Chat) => boolean), ms = 12000): Promise<boolean> => {
      const match = typeof id === "string" ? (c: Chat) => c.id === id : id;
      // Only auto-select if the user hasn't opened something else meanwhile.
      const startSel = selRef.current;
      for (let t = 0; t <= ms; t += 300) {
        const hit = chatsRef.current.find(match);
        if (hit) {
          if (selRef.current === startSel) pick(hit.id);
          return true;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      return false;
    },
    [pick, chatsRef, selRef],
  );

  // Everyone in our chats with a cached profile, for the New chat dialog's
  // instant local matches (the directory search needs a captured token).
  const knownPeople = useCallback((): PeopleHit[] => {
    const me = myMri();
    const seen = new Set<string>();
    const out: PeopleHit[] = [];
    for (const c of chatsRef.current) {
      if (c.kind !== "chat") continue;
      for (const mri of c.members) {
        if (mri === me || seen.has(mri) || !mri.startsWith("8:orgid:")) continue;
        seen.add(mri);
        const p = profile(mri);
        if (p.displayName)
          out.push({ mri, displayName: p.displayName, email: p.email || "", jobTitle: p.jobTitle || "" });
      }
    }
    return out;
  }, [chatsRef]);

  // Send `text` into an existing chat: chatsvc first, Teams' composer as fallback.
  const sendInto = useCallback(
    async (id: string, title: string, text: string): Promise<boolean> => {
      let r = await sendRemote(id, text, null, []);
      if (!r.ok && r.reason === "no-token") r = await sendMessage(id, title, text);
      if (!r.ok) flash(t().app.sentFailedAfterOpen(r.reason), 5000);
      return r.ok;
    },
    [flash],
  );

  // Start or open a chat with one or more people the way the stock UI does:
  // Teams' own New message + people picker (send.ts openNativeNewChat). Teams
  // decides whether a chat with exactly these people exists; if not, it shows
  // an empty draft that its first send creates (send.ts sendNativeDraft). The
  // overlay stays up and selects the chat once it is in our list.
  const startNewChat = useCallback(
    async (people: PeopleHit[], text: string): Promise<NewChatOutcome> => {
      const ppl = people.map(toPick);
      const missing = people.find((_, i) => !ppl[i].upn && !ppl[i].oid);
      if (missing) return { kind: "error", message: t().app.noEmail(missing.displayName || t().app.thisPerson) };
      const opened = async (id: string): Promise<NewChatOutcome> => {
        setNewChat(null);
        const known = chatsRef.current.find((c) => c.id === id);
        if (known) pick(id);
        if (text) await sendInto(id, known?.title || "", text);
        if (!known && !(await pickWhenListed(id))) flash(t().app.chatOpenedSoon, 4000);
        return { kind: "done" };
      };
      // A chat we list whose members aren't exactly these people (e.g. the 1:1
      // Teams shows mid-pick) is not the one asked for.
      const want = new Set(people.map((p) => p.mri));
      const wrongChat = (id: string): boolean => {
        const c = chatsRef.current.find((x) => x.id === id);
        if (!c || c.kind !== "chat") return false;
        const got = c.members.filter((m) => m !== myMri());
        return got.length !== want.size || got.some((m) => !want.has(m));
      };
      // A 1:1 we already list needs no trip through Teams.
      if (people.length === 1) {
        const dm = chatsRef.current.find(
          (c) => c.kind === "chat" && c.members.length === 1 && c.members[0] === people[0].mri,
        );
        if (dm) return opened(dm.id);
      }
      if (text) {
        // Teams may already show the draft for these people (dialog's 2nd step).
        let r = await sendNativeDraft(ppl, text);
        if (!r.ok && r.reason === "draft-changed") {
          const o = await openNativeNewChat(ppl);
          if (!o.ok) return { kind: "error", message: t().app.openInTeamsFailed(o.reason) };
          if (o.id && !wrongChat(o.id)) return opened(o.id);
          r = await sendNativeDraft(ppl, text);
        }
        if (!r.ok) return { kind: "error", message: t().app.notSent(r.reason) };
        setNewChat(null);
        if (!r.id || !(await pickWhenListed(r.id))) flash(t().app.chatCreatedSoon, 4000);
        return { kind: "done" };
      }
      const o = await openNativeNewChat(ppl);
      if (!o.ok) return { kind: "error", message: t().app.openInTeamsFailed(o.reason) };
      if (o.id && !wrongChat(o.id)) return opened(o.id);
      return { kind: "draft" };
    },
    [pick, sendInto, pickWhenListed, flash, chatsRef],
  );

  // "Message" on a profile: open the 1:1 (see startNewChat). A brand-new one
  // opens the New chat dialog on Teams' draft to take the first message.
  const startDirect = useCallback(
    async (mri: string): Promise<void> => {
      const p = profile(mri);
      const hit: PeopleHit = { mri, displayName: p.displayName || "", email: upnOf(mri), jobTitle: p.jobTitle || "" };
      const r = await startNewChat([hit], "");
      if (r.kind === "draft") setNewChat({ people: [hit], draft: true });
      else if (r.kind === "error") flash(r.message, 4000);
    },
    [startNewChat, flash],
  );

  // Place an audio/video call the way the stock UI does: open the chat in Teams
  // and press its own header call button (send.ts startNativeCall). A person is
  // called through their 1:1 chat. No deep-link fallback: navigating to a
  // teams.microsoft.com/l/ link replaces the Teams page with the web launcher.
  const startCall = useCallback(
    async (mris: string[], kind: "audio" | "video", chat?: Chat): Promise<void> => {
      const target =
        chat ||
        (mris.length === 1
          ? chatsRef.current.find((c) => c.kind === "chat" && c.members.length === 1 && c.members[0] === mris[0])
          : undefined);
      if (!target) {
        flash(t().app.noDmToCall, 4000);
        return;
      }
      // The overlay stays up: Teams' buttons are clicked underneath it, and the
      // call-window guard (mount.tsx) hides the overlay wherever the call shows.
      const res = await startNativeCall(target.id, target.title, kind);
      if (!res.ok) flash(t().app.callFailed(res.reason), 4000);
    },
    [flash, chatsRef],
  );

  // Join the selected conversation's running call through Teams' own Join
  // button (send.ts joinNativeMeeting); the call-window guard hides the overlay.
  const joinCall = useCallback(
    async (rootId: string): Promise<void> => {
      const c = chatsRef.current.find((x) => x.id === sel);
      if (!c) return;
      const res = await joinNativeMeeting(c.id, c.title, rootId);
      if (!res.ok) flash(t().app.joinFailed(res.reason), 4000);
    },
    [sel, flash, chatsRef],
  );

  // Start a meeting in the selected channel (Teams' "Meet now").
  const meetNow = useCallback(async (): Promise<void> => {
    const c = chatsRef.current.find((x) => x.id === sel);
    if (!c) return;
    const res = await startNativeChannelMeeting(c.id, c.title);
    if (!res.ok) flash(t().app.meetingFailed(res.reason), 4000);
  }, [sel, flash, chatsRef]);

  // Apply a change to our list at once and put the old fields back (with a
  // flash) when Teams refuses it. Used by every chat action below.
  const optimistic = useCallback(
    async (
      chat: Chat,
      next: Partial<Chat>,
      write: () => Promise<WriteResult>,
      failed: (reason: string) => string,
    ): Promise<boolean> => {
      setChats((cs) => cs.map((c) => (c.id === chat.id ? { ...c, ...next } : c)));
      const res = await write();
      if (res.ok) return true;
      const back = Object.fromEntries(Object.keys(next).map((k) => [k, chat[k as keyof Chat]]));
      setChats((cs) => cs.map((c) => (c.id === chat.id ? { ...c, ...back } : c)));
      flash(failed(res.reason), 4000);
      return false;
    },
    [flash, setChats],
  );

  // Set a chat's read/unread state (used by the right-click menu). Writes the
  // read pointer to Teams (syncs all devices).
  const setChatUnread = useCallback(
    async (chat: Chat, wantUnread: boolean): Promise<void> => {
      await optimistic(
        chat,
        { unread: wantUnread },
        () => (wantUnread ? markUnread(chat.id, chat.time) : markRead(chat.id, chat.time)),
        t().app.readStateFailed,
      );
    },
    [optimistic],
  );

  // Hide or unhide a chat (right-click menu).
  const setHidden = useCallback(
    async (chat: Chat, hidden: boolean): Promise<void> => {
      if (
        (await optimistic(
          chat,
          { hidden },
          () => setChatHidden(chat.id, hidden),
          (r) => t().app.hideFailed(hidden, r),
        )) &&
        hidden
      ) {
        flash(t().app.chatHidden, 4000);
      }
    },
    [optimistic, flash],
  );

  // Add to or remove from Teams' Favorites (right-click menu).
  const setFavorite = useCallback(
    (chat: Chat, favorite: boolean): Promise<boolean> =>
      optimistic(
        chat,
        { favorite },
        () => setChatFavorite(chat.id, favorite),
        (r) => t().app.favoriteFailed(favorite, r),
      ),
    [optimistic],
  );

  const rename = useCallback(
    (chat: Chat, title: string): Promise<boolean> => {
      const name = title.trim();
      if (!name || name === chat.title) return Promise.resolve(true);
      return optimistic(chat, { title: name }, () => renameChat(chat.id, name), t().app.renameFailed);
    },
    [optimistic],
  );

  const setMuted = useCallback(
    async (chat: Chat, muted: boolean): Promise<void> => {
      if (
        await optimistic(
          chat,
          { muted },
          () => setChatMuted(chat.id, muted),
          (r) => t().app.muteFailed(muted, r),
        )
      ) {
        flash(muted ? t().app.muted : t().app.unmuted, 3000);
      }
    },
    [optimistic, flash],
  );

  const addMembers = useCallback(
    async (chat: Chat, people: PeopleHit[], shareHistoryDays = 0): Promise<boolean> => {
      const mris = people.map((p) => p.mri).filter((m) => !chat.members.includes(m));
      if (!mris.length) return true;
      return optimistic(
        chat,
        { members: [...chat.members, ...mris] },
        () => addChatMembers(chat.id, mris, shareHistoryDays),
        t().app.addFailed,
      );
    },
    [optimistic],
  );

  const removeMember = useCallback(
    (chat: Chat, mri: string): Promise<boolean> =>
      optimistic(
        chat,
        { members: chat.members.filter((m) => m !== mri) },
        () => removeChatMember(chat.id, mri),
        t().app.removeFailed,
      ),
    [optimistic],
  );

  // Leave a group chat; for a channel, leave or hide the channel itself, leave
  // its whole team, or delete it (getChannelActions decides; the menus already
  // named which).
  const leave = useCallback(
    async (chat: Chat, what: "channel" | "team" | "delete" = "channel"): Promise<void> => {
      if (!chat.isChannel) {
        if (await optimistic(chat, { left: true, hidden: true }, () => leaveChat(chat.id), t().app.leaveFailed)) {
          flash(t().app.left(chat.title), 4000);
        }
        return;
      }
      const acts = await getChannelActions(chat.id);
      if (!acts) {
        flash(t().app.leaveChannelFailed("no channel info"), 4000);
        return;
      }
      if (what === "delete") {
        if (
          await optimistic(chat, { left: true, hidden: true }, () => deleteChannel(acts), t().app.deleteChannelFailed)
        ) {
          flash(t().app.channelDeleted(chat.title), 4000);
        }
        return;
      }
      const team = what === "team";
      const run = team ? () => leaveTeam(acts) : () => leaveChannel(acts);
      if (!(await optimistic(chat, { left: true, hidden: true }, run, t().app.leaveChannelFailed))) return;
      // The team's other channels go too; the next poll drops them for good.
      if (team)
        setChats((cs) => cs.map((c) => (c.isChannel && c.team === chat.team ? { ...c, left: true, hidden: true } : c)));
      flash(
        team
          ? t().app.left(chat.team || chat.title)
          : acts.channel === "hide"
            ? t().app.channelHidden(chat.title)
            : t().app.left(chat.title),
        4000,
      );
    },
    [optimistic, flash, setChats],
  );

  // Add a channel to `from`'s team, then open it once the list has it. A
  // private channel may come back without its id: it shows up with a later
  // poll, so find it there by team and name (unique within a team). People
  // picked for a private channel are added once it is listed. Resolves to an
  // error text for the dialog, or null.
  const addChannel = useCallback(
    async (
      from: Chat,
      name: string,
      desc: string,
      priv: boolean,
      threads: boolean,
      people: PeopleHit[] = [],
    ): Promise<string | null> => {
      const acts = await getChannelActions(from.id);
      if (!acts) return t().app.createChannelFailed("no channel info");
      const r = await createChannel(acts, name, desc, priv, threads);
      if (!r.ok) return t().app.createChannelFailed(r.reason);
      setNewChannel(null);
      const title = name.trim();
      flash(r.id ? t().app.channelCreated(title) : t().app.channelCreatedSoon(title), r.id ? 4000 : 5000);
      const byName = (c: Chat) => c.kind === from.kind && c.team === from.team && c.title === title;
      void (async () => {
        const listed = await pickWhenListed(r.id || byName, 60000);
        const id = r.id || chatsRef.current.find(byName)?.id;
        if (!people.length || !listed || !id) return;
        const created = await getChannelActions(id);
        const added = created
          ? await addChannelMembers(
              created,
              people.map((p) => p.mri),
            )
          : { ok: false as const, reason: "no channel info" };
        flash(added.ok ? t().app.membersAdded(people.length) : t().app.addFailed(added.reason), added.ok ? 3000 : 5000);
      })();
      return null;
    },
    [flash, pickWhenListed, chatsRef],
  );

  // The team label's "+": open the dialog only where Teams lets us add one.
  const openNewChannel = useCallback(
    async (from: Chat): Promise<void> => {
      const acts = await getChannelActions(from.id);
      if (acts?.create) setNewChannel(from);
      else flash(t().app.cantAddChannel, 4000);
    },
    [flash],
  );

  return {
    newChat,
    setNewChat,
    newChannel,
    setNewChannel,
    openNewChannel,
    createChannel: addChannel,
    knownPeople,
    startNewChat,
    startDirect,
    startCall,
    joinCall,
    meetNow,
    setChatUnread,
    setHidden,
    setFavorite,
    rename,
    setMuted,
    addMembers,
    removeMember,
    leave,
  };
}
