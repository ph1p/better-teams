import { describe, expect, it, vi } from "vitest";

vi.mock("../../teamsData", () => ({ profile: () => ({ displayName: "" }) }));

import type { Chat } from "../../types";
import { buildSections } from "./sections";

const chat = (id: string, time: number, extra: Partial<Chat> = {}) =>
  ({ id, title: "Anna " + id, kind: "chat", group: false, app: false, team: "", members: [], time, ...extra }) as Chat;

describe("buildSections search", () => {
  it("lists 1:1 chats first, then the rest, each newest first", () => {
    const chats = [
      chat("group-new", 50, { group: true }),
      chat("dm-old", 10),
      chat("chan", 40, { kind: "channel", isChannel: true }),
      chat("dm-new", 30),
    ];
    const rows = buildSections(chats, "anna", false, new Set())[0].rows.map((c) => c.id);
    expect(rows).toEqual(["dm-new", "dm-old", "group-new", "chan"]);
  });
});
