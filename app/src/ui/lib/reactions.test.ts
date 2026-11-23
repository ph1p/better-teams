import { describe, expect, it } from "vitest";
import { glyphFor } from "./reactions";

describe("glyphFor", () => {
  it("maps wider Teams emoticon ids", () => {
    expect(glyphFor("raisedfist")).toBe("✊");
    expect(glyphFor("fistbump")).toBe("👊");
  });
  it("adds the skin tone to a mapped or hex key", () => {
    expect(glyphFor("raisedfist-tone2")).toBe("✊\u{1F3FC}");
    expect(glyphFor("1f44d-tone5")).toBe("👍\u{1F3FF}");
  });
  it("decodes hex-codepoint keys, else shows the key", () => {
    expect(glyphFor("1f52d_telescope")).toBe("🔭");
    expect(glyphFor("nosuchemoticon")).toBe("nosuchemoticon");
    expect(glyphFor("nosuch-tone2")).toBe("nosuch-tone2");
  });
});
