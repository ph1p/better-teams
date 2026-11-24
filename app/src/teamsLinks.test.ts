import { describe, expect, it } from "vitest";
import { parseTeamsLink } from "./teamsLinks";

describe("parseTeamsLink", () => {
  it("reads a channel message link", () => {
    expect(
      parseTeamsLink(
        "https://teams.microsoft.com/l/message/19:abc@thread.skype/1700000000000?tenantId=t&groupId=g&parentMessageId=1700000000000&teamName=A&channelName=B&createdTime=1700000000000",
      ),
    ).toEqual({ cid: "19:abc@thread.skype", mid: "1700000000000" });
  });
  it("decodes an encoded thread id", () => {
    expect(parseTeamsLink("https://teams.microsoft.com/l/message/19%3Aabc%40thread.v2/42?context=x")).toEqual({
      cid: "19:abc@thread.v2",
      mid: "42",
    });
  });
  it("reads chat and channel links without a message", () => {
    expect(parseTeamsLink("https://teams.microsoft.com/l/chat/19:x@unq.gbl.spaces/conversations")).toEqual({
      cid: "19:x@unq.gbl.spaces",
      mid: "",
    });
    expect(parseTeamsLink("https://teams.microsoft.com/l/channel/19%3Ay%40thread.tacv2/General?groupId=g")).toEqual({
      cid: "19:y@thread.tacv2",
      mid: "",
    });
  });
  it("ignores other links", () => {
    expect(parseTeamsLink("https://teams.microsoft.com/l/meetup-join/19:m@thread.v2/0")).toBeNull();
    expect(parseTeamsLink("https://example.com/l/message/19:a@thread.v2/1")).toBeNull();
    expect(parseTeamsLink("not a url")).toBeNull();
  });
});
