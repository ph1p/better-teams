import { describe, expect, it } from "vitest";
import { buildMentionContent, claimMentions, editMentions, parseMentions, type MentionPick } from "./mentions";
import { htmlToMarkdown } from "./ui/lib/htmlToMarkdown";

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

describe("parseMentions", () => {
  it("reads the IDB JSON string and CDL arrays", () => {
    expect(
      parseMentions('[{"itemid":"0","mri":"8:orgid:a","mentionType":"person","displayName":"Maya Chen"}]'),
    ).toEqual([{ itemid: 0, mri: "8:orgid:a", name: "Maya Chen", mentionType: "person" }]);
    expect(parseMentions([{ itemId: 1, userId: "8:orgid:b", displayName: "Bo" }])).toEqual([
      { itemid: 1, mri: "8:orgid:b", name: "Bo", mentionType: "person" },
    ]);
  });
  it("drops junk", () => {
    expect(parseMentions("not json")).toEqual([]);
    expect(parseMentions([null, { itemid: 0 }])).toEqual([]);
  });
});

describe("editMentions + htmlToMarkdown", () => {
  const span = (id: number, name: string) =>
    `<span itemtype="http://schema.skype.com/Mention" itemscope itemid="${id}">${name}</span>`;
  it("turns mention spans back into @Name with picks", () => {
    const em = editMentions(parseMentions([{ itemid: 0, mri: "8:a", displayName: "Maya Chen" }]));
    expect(htmlToMarkdown(`<p>hi ${span(0, "Maya Chen")} ok</p>`, em.mark)).toBe("hi @Maya Chen ok");
    expect(em.picks()).toEqual([{ mri: "8:a", name: "Maya Chen", mentionType: "person" }]);
  });
  it("merges Teams' one-span-per-word mentions", () => {
    const em = editMentions(
      parseMentions([
        { itemid: 0, mri: "8:a", displayName: "Maya" },
        { itemid: 1, mri: "8:a", displayName: "Chen" },
      ]),
    );
    expect(htmlToMarkdown(`<p>${span(0, "Maya")} ${span(1, "Chen")}</p>`, em.mark)).toBe("@Maya Chen");
    expect(em.picks()).toEqual([{ mri: "8:a", name: "Maya Chen", mentionType: "person" }]);
  });
  it("leaves spans plain without a mention hook", () => {
    expect(htmlToMarkdown(`<p>${span(0, "Maya")}</p>`)).toBe("Maya");
  });
});
