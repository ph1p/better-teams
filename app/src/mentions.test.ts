import { describe, expect, it } from "vitest";
import { buildMentionContent, claimMentions, type MentionPick } from "./mentions";

const ann: MentionPick = { mri: "1", name: "Ann", mentionType: "person" };
const annLee: MentionPick = { mri: "2", name: "Ann Lee", mentionType: "person" };

describe("claimMentions", () => {
  it("lets the longer name win at its own position", () => {
    expect(claimMentions("@Ann @Ann Lee", [ann, annLee])).toEqual([
      { start: 0, end: 4, pick: ann },
      { start: 5, end: 13, pick: annLee },
    ]);
  });
});

describe("buildMentionContent", () => {
  it("escapes text and emits a mention span", () => {
    const bo: MentionPick = { mri: "1", name: "Bo", mentionType: "person" };
    const out = buildMentionContent("a<b @Bo", [bo]);
    expect(out.html).toBe('a&lt;b <span itemtype="http://schema.skype.com/Mention" itemscope itemid="0">Bo</span>');
    const parsed = JSON.parse(out.mentions);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ itemid: 0, mri: "1" });
  });
});
