import { describe, expect, it } from "vitest";
import { fenceAt } from "./editKeys";

describe("fenceAt", () => {
  const v = "hi\n```ts\nconst a = 1;\nlet b;\n```\nbye";
  it("finds the block around the caret, fence lines included", () => {
    const f = fenceAt(v, v.indexOf("const"));
    expect(f).toEqual({ start: 3, end: v.indexOf("\nbye"), lang: "ts", code: "const a = 1;\nlet b;" });
    expect(fenceAt(v, 3)?.lang).toBe("ts");
    expect(fenceAt(v, v.indexOf("\nbye"))?.lang).toBe("ts");
  });
  it("is null outside a block", () => {
    expect(fenceAt(v, 1)).toBeNull();
    expect(fenceAt(v, v.length)).toBeNull();
  });
  it("handles an unclosed and an empty block", () => {
    expect(fenceAt("x\n```py\nprint(1)", 9)).toEqual({ start: 2, end: 16, lang: "py", code: "print(1)" });
    expect(fenceAt("```\n```", 2)).toEqual({ start: 0, end: 7, lang: "", code: "" });
  });
});
