import { describe, expect, it } from "vitest";
import { nativeFallbackBlocker } from "./sendFallback";

const quote = { id: "123", from: "A", text: "t", fromMri: "8:x", time: 0 };
const pick = { any: "pick" };

describe("nativeFallbackBlocker", () => {
  it("allows plain text", () => {
    expect(nativeFallbackBlocker(null, [])).toBeNull();
  });
  it("blocks a quote", () => {
    expect(nativeFallbackBlocker(quote, [])).toBe("fallback-quote");
  });
  it("blocks mentions", () => {
    expect(nativeFallbackBlocker(null, [pick])).toBe("fallback-mentions");
  });
  it("reports the quote first when both are set", () => {
    expect(nativeFallbackBlocker(quote, [pick])).toBe("fallback-quote");
  });
});
