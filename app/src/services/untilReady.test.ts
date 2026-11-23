import { describe, expect, it, vi } from "vitest";
import { untilReady } from "./untilReady";

describe("untilReady", () => {
  it("returns true when ready on the first wait", async () => {
    const wait = vi.fn().mockResolvedValue(true);
    expect(await untilReady(wait, () => false)).toBe(true);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting past timed-out slices", async () => {
    const wait = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await untilReady(wait, () => false)).toBe(true);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it("never waits when already stopped", async () => {
    const wait = vi.fn().mockResolvedValue(true);
    expect(await untilReady(wait, () => true)).toBe(false);
    expect(wait).not.toHaveBeenCalled();
  });

  it("returns false when stopped while pending", async () => {
    let stopped = false;
    const wait = vi.fn(async () => {
      stopped = true;
      return true;
    });
    expect(await untilReady(wait, () => stopped)).toBe(false);
  });

  it("does not loop forever after stop", async () => {
    let stopped = false;
    const wait = vi.fn(async () => {
      if (wait.mock.calls.length >= 2) stopped = true;
      return false;
    });
    expect(await untilReady(wait, () => stopped)).toBe(false);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});
