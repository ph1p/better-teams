import { describe, expect, it } from "vitest";
import { isNewer } from "./update";

describe("isNewer", () => {
  it("compares release versions numerically", () => {
    expect(isNewer("v1.10.0", "1.9.3")).toBe(true);
    expect(isNewer("v1.2.0", "1.2.0")).toBe(false);
    expect(isNewer("1.1.9", "1.2.0")).toBe(false);
    expect(isNewer("v2.0.0", "1.99.99")).toBe(true);
  });

  it("never flags dev or unparsable builds", () => {
    expect(isNewer("v9.0.0", "dev")).toBe(false);
    expect(isNewer("", "1.0.0")).toBe(false);
    expect(isNewer("v2.0.0-beta.1", "1.0.0")).toBe(false);
  });
});
