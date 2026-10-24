import { describe, it, expect } from "vitest";
import { CorpseRoster } from "../corpseRoster";

describe("CorpseRoster", () => {
  it("keeps every corpse while under the cap", () => {
    const r = new CorpseRoster<string>({ cap: 3, fadeSeconds: 1.5 });
    r.add("a");
    r.add("b");
    r.add("c");
    expect(r.fading()).toEqual([]);
    expect(r.size).toBe(3);
  });

  it("starts fading the oldest corpse once the cap is exceeded", () => {
    const r = new CorpseRoster<string>({ cap: 2, fadeSeconds: 1.5 });
    r.add("a");
    r.add("b");
    r.add("c");
    expect(r.fading()).toEqual(["a"]);
    expect(r.fadeAlpha("a")).toBe(1);
    expect(r.fadeAlpha("c")).toBe(1);
  });

  it("fades out over fadeSeconds and then reports the corpse for removal", () => {
    const r = new CorpseRoster<string>({ cap: 1, fadeSeconds: 1.5 });
    r.add("a");
    r.add("b");
    expect(r.update(0.75)).toEqual([]);
    expect(r.fadeAlpha("a")).toBeCloseTo(0.5, 6);
    expect(r.update(0.8)).toEqual(["a"]);
    expect(r.size).toBe(1);
    expect(r.has("a")).toBe(false);
  });

  it("drops the oldest fading corpse immediately when far over the cap (spam protection)", () => {
    const r = new CorpseRoster<number>({ cap: 2, fadeSeconds: 1.5, hardExtra: 1 });
    const removed: number[] = [];
    for (let i = 0; i < 6; i++) removed.push(...r.add(i));
    // cap 2 + 1 fading allowed => never more than 3 alive at once.
    expect(r.size).toBeLessThanOrEqual(3);
    expect(removed).toEqual([0, 1, 2]);
  });

  it("clear() returns everything that was tracked", () => {
    const r = new CorpseRoster<string>({ cap: 5, fadeSeconds: 1 });
    r.add("a");
    r.add("b");
    expect(r.clear().sort()).toEqual(["a", "b"]);
    expect(r.size).toBe(0);
  });
});
