import { describe, expect, it } from "vitest";
import { extOf, mriOf, toMs } from "./raw";

describe("toMs", () => {
  it.each([
    [null, 0],
    ["", 0],
    [5, 5],
    ["7", 7],
    ["2026-01-01T00:00:00Z", 1767225600000],
    ["junk", 0],
  ])("%j -> %j", (input, expected) => {
    expect(toMs(input)).toBe(expected);
  });
});

describe("mriOf", () => {
  it.each([
    ["https://x/contacts/8:orgid:abc", "8:orgid:abc"],
    ["8:orgid:abc", "8:orgid:abc"],
    [null, ""],
  ])("%j -> %j", (input, expected) => {
    expect(mriOf(input)).toBe(expected);
  });
});

describe("extOf", () => {
  it.each([
    ["Plan.PDF", "pdf"],
    ["noext", ""],
    ["a.tar.gz", "gz"],
  ])("%j -> %j", (input, expected) => {
    expect(extOf(input)).toBe(expected);
  });
});
