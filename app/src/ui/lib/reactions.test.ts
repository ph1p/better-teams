import { describe, expect, it } from "vitest";
import { glyphFor, searchShortcodes, shortcodeGlyph } from "./reactions";

describe("glyphFor", () => {
  it("maps wider Teams emoticon ids", () => {
    expect(glyphFor("raisedfist")).toBe("✊");
    expect(glyphFor("fistbump")).toBe("👊");
    expect(glyphFor("smileeyes")).toBe("😊");
    expect(glyphFor("heartonfire")).toBe("❤️‍🔥");
  });
  it("adds the skin tone to a mapped or hex key", () => {
    expect(glyphFor("raisedfist-tone2")).toBe("✊\u{1F3FC}");
    expect(glyphFor("1f44d-tone5")).toBe("👍\u{1F3FF}");
  });
  it("decodes hex-codepoint keys, else shows the key", () => {
    expect(glyphFor("1f52d_telescope")).toBe("🔭");
    expect(glyphFor("2639_frowningface")).toBe("☹️");
    expect(glyphFor("nosuchemoticon")).toBe("nosuchemoticon");
    expect(glyphFor("nosuch-tone2")).toBe("nosuch-tone2");
  });
});

describe("searchShortcodes", () => {
  it("ranks prefix matches first, one row per glyph", () => {
    const hits = searchShortcodes("smi");
    expect(hits[0]).toEqual({ name: "smile", glyph: "😄" });
    expect(new Set(hits.map((h) => h.glyph)).size).toBe(hits.length);
    expect(searchShortcodes("")).toEqual([]);
  });
  it("resolves exact names", () => {
    expect(shortcodeGlyph("tada")).toBe("🎉");
    expect(shortcodeGlyph("+1")).toBe("👍");
    expect(shortcodeGlyph("nope")).toBeUndefined();
  });
});
