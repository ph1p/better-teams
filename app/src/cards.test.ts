import { describe, expect, it } from "vitest";
import { cardSummary, parseCards, plainCardText } from "./cards";

const adaptive = {
  type: "AdaptiveCard",
  body: [
    { type: "TextBlock", text: "Bot updated the **Status** on this issue:" },
    { type: "TextBlock", text: "[WEB-1 Fix it](https://example.com/WEB-1)" },
    { type: "TextBlock", text: "hidden", isVisible: false },
    { type: "FactSet", facts: [{ title: "Priority", value: "High" }] },
  ],
};

const swift = (attachments: unknown[]): string =>
  `<URIObject type="SWIFT.1"><Swift b64="${btoa(
    String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ type: "message/card", attachments }))),
  )}"/></URIObject>`;

describe("parseCards", () => {
  it("reads the Swift payload of a Media_Card", () => {
    const cards = parseCards(swift([{ contentType: "application/vnd.microsoft.card.adaptive", content: adaptive }]));
    expect(cards).toHaveLength(1);
    expect(cards[0].contentType).toBe("application/vnd.microsoft.card.adaptive");
    expect(cards[0].content.type).toBe("AdaptiveCard");
  });

  it("reads a cards list given as a JSON string with string content", () => {
    const list = JSON.stringify([{ contentType: "x", content: JSON.stringify(adaptive) }]);
    expect(parseCards("<p>hi</p>", list)[0].content).toEqual(adaptive);
  });

  it("reads a cards array and skips broken entries", () => {
    const cards = parseCards("", [{ contentType: "x", content: adaptive }, { content: "{not json" }, 7]);
    expect(cards).toHaveLength(1);
  });

  it("returns nothing for plain messages", () => {
    expect(parseCards("<p>hi</p>")).toEqual([]);
    expect(parseCards('<Swift b64="!!!"/>')).toEqual([]);
  });
});

describe("cardSummary", () => {
  it("joins the first visible texts of an Adaptive Card", () => {
    expect(cardSummary([{ contentType: "", content: adaptive }])).toBe(
      "Bot updated the Status on this issue: · WEB-1 Fix it · Priority High",
    );
  });

  it("uses title and text of hero / connector cards", () => {
    expect(cardSummary([{ contentType: "", content: { title: "Build failed", text: "main · #42" } }])).toBe(
      "Build failed · main · #42",
    );
    expect(cardSummary([{ contentType: "", content: { sections: [{ activityTitle: "Deploy done" }] } }])).toBe(
      "Deploy done",
    );
  });
});

describe("plainCardText", () => {
  it("strips markdown, tags and date templates", () => {
    expect(plainCardText("From **NONE** to {{DATE(2026-11-23T15:58:00Z, SHORT)}} <at>Ann</at>")).toBe(
      "From NONE to 2026-11-23T15:58:00Z Ann",
    );
  });
});
