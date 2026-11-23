import { describe, expect, it } from "vitest";
import { glyphFor } from "./reactions";

const r = (key: string, glyph = key) => ({ key, glyph, count: 1, mine: false });

describe("glyphFor", () => {
  it("maps wider Teams emoticon ids", () => {
    expect(glyphFor(r("raisedfist"))).toBe("✊");
    expect(glyphFor(r("fistbump"))).toBe("👊");
  });
  it("adds the skin tone to a mapped id", () => {
    expect(glyphFor(r("raisedfist-tone2"))).toBe("✊\u{1F3FC}");
  });
  it("falls back to the decoded glyph, then the key", () => {
    expect(glyphFor(r("1f52d_telescope", "🔭"))).toBe("🔭");
    expect(glyphFor(r("nosuchemoticon"))).toBe("nosuchemoticon");
  });
});
