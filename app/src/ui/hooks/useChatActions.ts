import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { markRead, markUnread, myMri, profile, sendRemote, setChatHidden, type PeopleHit } from "../../teamsData";
import {
  joinNativeMeeting, openNativeNewChat, sendMessage, sendNativeDraft, startNativeCall, startNativeChannelMeeting, type PickPerson,
} from "../../send";
import type { NewChatOutcome } from "../sidebar/NewChat";
import type { Flash } from "../lib/toast";
import type { Chat } from "../../types";

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
  const [newChat, setNewChat] = useState<NewChatState>(null);

  // Select a chat once our list knows it. A chat Teams just created only shows
  // up after the next poll picks it out of Teams' local store.
  const pickWhenListed = useCallback(async (id: string, ms = 12000): Promise<boolean> => {
    for (let t = 0; t <= ms; t += 300) {
      if (chatsRef.current.some((c) => c.id === id)) { pick(id); return true; }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }, [pick, chatsRef]);

  // Everyone in our chats with a cached profile, for the New chat dialog's
  // instant local matches (the directory search needs a captured token).
  const knownPeople = useCallback((): PeopleHit[] => {
    const me = myMri();
    const seen = new Set<string>();
    const out: PeopleHit[] = [];
    for (const c of chatsRef.current) {
      if (c.kind !== "chat") continue;
      for (const mri of c.members) {
        if (mri === me || seen.has(mri) || !/^8:orgid:/.test(mri)) continue;
        seen.add(mri);
        const p = profile(mri);
        if (p.displayName) out.push({ mri, displayName: p.displayName, email: p.email || "", jobTitle: p.jobTitle || "" });
      }
    }
    return out;
  }, [chatsRef]);

  // Send `text` into an existing chat: chatsvc first, Teams' composer as fallback.
  const sendInto = useCallback(async (id: string, title: string, text: string): Promise<boolean> => {
    let r = await sendRemote(id, text, null, []);
    if (!r.ok && r.reason === "no-token") r = await sendMessage(id, title, text);
    if (!r.ok) flash("Opened the chat, but the message wasn't sent (" + r.reason + ")", 5000);
    return r.ok;
  }, [flash]);

  // Start or open a chat with one or more people the way the stock UI does:
  // Teams' own New message + people picker (send.ts openNativeNewChat). Teams
  // decides whether a chat with exactly these people exists; if not, it shows
  // an empty draft that its first send creates (send.ts sendNativeDraft). The
  // overlay stays up and selects the chat once it is in our list.
  const startNewChat = useCallback(async (people: PeopleHit[], text: string): Promise<NewChatOutcome> => {
    const ppl = people.map(toPick);
    const missing = people.find((_, i) => !ppl[i].upn && !ppl[i].oid);
    if (missing) return { kind: "error", message: "No email on file for " + (missing.displayName || "this person") + "." };
    const opened = async (id: string): Promise<NewChatOutcome> => {
      setNewChat(null);
      const known = chatsRef.current.find((c) => c.id === id);
      if (known) pick(id);
      if (text) await sendInto(id, known?.title || "", text);
      if (!known && !(await pickWhenListed(id))) flash("Chat opened in Teams. It shows up here shortly.", 4000);
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
      const dm = chatsRef.current.find((c) => c.kind === "chat" && c.members.length === 1 && c.members[0] === people[0].mri);
      if (dm) return opened(dm.id);
    }
    if (text) {
      // Teams may already show the draft for these people (dialog's 2nd step).
      let r = await sendNativeDraft(ppl, text);
      if (!r.ok && r.reason === "draft-changed") {
        const o = await openNativeNewChat(ppl);
        if (!o.ok) return { kind: "error", message: "Couldn't open the chat in Teams (" + o.reason + ")" };
        if (o.id && !wrongChat(o.id)) return opened(o.id);
        r = await sendNativeDraft(ppl, text);
      }
      if (!r.ok) return { kind: "error", message: "Not sent (" + r.reason + ")" };
      setNewChat(null);
      if (!r.id || !(await pickWhenListed(r.id))) flash("Chat created in Teams. It shows up here shortly.", 4000);
      return { kind: "done" };
    }
    const o = await openNativeNewChat(ppl);
    if (!o.ok) return { kind: "error", message: "Couldn't open the chat in Teams (" + o.reason + ")" };
    if (o.id && !wrongChat(o.id)) return opened(o.id);
    return { kind: "draft" };
  }, [pick, sendInto, pickWhenListed, flash, chatsRef]);

  // "Message" on a profile: open the 1:1 (see startNewChat). A brand-new one
  // opens the New chat dialog on Teams' draft to take the first message.
  const startDirect = useCallback(async (mri: string): Promise<void> => {
    const p = profile(mri);
    const hit: PeopleHit = { mri, displayName: p.displayName || "", email: upnOf(mri), jobTitle: p.jobTitle || "" };
    const r = await startNewChat([hit], "");
    if (r.kind === "draft") setNewChat({ people: [hit], draft: true });
    else if (r.kind === "error") flash(r.message, 4000);
  }, [startNewChat, flash]);

  // Place an audio/video call the way the stock UI does: open the chat in Teams
  // and press its own header call button (send.ts startNativeCall). A person is
  // called through their 1:1 chat. No deep-link fallback: navigating to a
  // teams.microsoft.com/l/ link replaces the Teams page with the web launcher.
  const startCall = useCallback(async (mris: string[], kind: "audio" | "video", chat?: Chat): Promise<void> => {
    const target = chat || (mris.length === 1
      ? chatsRef.current.find((c) => c.kind === "chat" && c.members.length === 1 && c.members[0] === mris[0])
      : undefined);
    if (!target) { flash("No 1:1 chat with this person yet — start one to call them.", 4000); return; }
    // The overlay stays up: Teams' buttons are clicked underneath it, and the
    // call-window guard (mount.tsx) hides the overlay wherever the call shows.
    const res = await startNativeCall(target.id, target.title, kind);
    if (!res.ok) flash("Couldn't start the call (" + res.reason + ")", 4000);
  }, [flash, chatsRef]);

  // Join the selected conversation's running call through Teams' own Join
  // button (send.ts joinNativeMeeting); the call-window guard hides the overlay.
  const joinCall = useCallback(async (rootId: string): Promise<void> => {
    const c = chatsRef.current.find((x) => x.id === sel);
    if (!c) return;
    const res = await joinNativeMeeting(c.id, c.title, rootId);
    if (!res.ok) flash("Couldn't join the call (" + res.reason + ")", 4000);
  }, [sel, flash, chatsRef]);

  // Start a meeting in the selected channel (Teams' "Meet now").
  const meetNow = useCallback(async (): Promise<void> => {
    const c = chatsRef.current.find((x) => x.id === sel);
    if (!c) return;
    const res = await startNativeChannelMeeting(c.id, c.title);
    if (!res.ok) flash("Couldn't start the meeting (" + res.reason + ")", 4000);
  }, [sel, flash, chatsRef]);

  // Set a chat's read/unread state (used by the right-click menu). Optimistic;
  // reverts on failure. Writes the read pointer to Teams (syncs all devices).
  const setChatUnread = useCallback(async (chat: Chat, wantUnread: boolean): Promise<void> => {
    const id = chat.id;
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: wantUnread } : c)));
    const res = wantUnread ? await markUnread(id, chat.time) : await markRead(id, chat.time);
    if (!res.ok) {
      setChats((cs) => cs.map((c) => (c.id === id ? { ...c, unread: !wantUnread } : c)));
      flash("Couldn't change read state (" + res.reason + ")");
    }
  }, [flash, setChats]);

  // Hide or unhide a chat (right-click menu). Optimistic; reverts on failure.
  const setHidden = useCallback(async (chat: Chat, hidden: boolean): Promise<void> => {
    const id = chat.id;
    setChats((cs) => cs.map((c) => (c.id === id ? { ...c, hidden } : c)));
    const res = await setChatHidden(id, hidden);
    if (!res.ok) {
      setChats((cs) => cs.map((c) => (c.id === id ? { ...c, hidden: !hidden } : c)));
      flash("Couldn't " + (hidden ? "hide" : "unhide") + " chat (" + res.reason + ")");
    } else if (hidden) flash("Chat hidden. Search finds it; a new message brings it back.", 4000);
  }, [flash, setChats]);

  return {
    newChat, setNewChat, knownPeople, startNewChat, startDirect, startCall, joinCall, meetNow, setChatUnread, setHidden,
  };
}
