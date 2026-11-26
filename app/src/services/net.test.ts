import { describe, expect, it } from "vitest";
import { classify, type Sample } from "./net";

const now = 100_000;
const s = (ago: number, ok: boolean, ms = 100): Sample => ({ at: now - ago, ok, ms });

describe("classify", () => {
  it("is online with healthy samples or none", () => {
    expect(classify([], now, true, false)).toBe("online");
    expect(classify([s(5000, true), s(1000, true)], now, true, false)).toBe("online");
  });
  it("trusts the browser's offline flag", () => {
    expect(classify([s(1000, true)], now, false, false)).toBe("offline");
  });
  it("is offline after two failures in a row", () => {
    expect(classify([s(5000, true), s(3000, false), s(1000, false)], now, true, false)).toBe("offline");
  });
  it("is unstable after a single failure or slow answers", () => {
    expect(classify([s(3000, false), s(1000, true)], now, true, false)).toBe("unstable");
    expect(classify([s(1000, false)], now, true, false)).toBe("unstable");
    expect(classify([s(3000, true, 3000), s(1000, true, 5000)], now, true, false)).toBe("unstable");
    expect(classify([s(1000, true)], now, true, true)).toBe("unstable");
  });
  it("forgets samples older than 30 s", () => {
    expect(classify([s(40_000, false), s(35_000, false), s(1000, true)], now, true, false)).toBe("online");
  });
});
