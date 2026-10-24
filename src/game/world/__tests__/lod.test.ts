import { afterEach, describe, expect, it } from "vitest";
import { bandVisible, getViewScale, setViewScale, viewScaleVersion } from "../lod";

afterEach(() => setViewScale(1));

describe("view scale", () => {
  it("defaults to 1 and bumps its version on change only", () => {
    expect(getViewScale()).toBe(1);
    const v0 = viewScaleVersion();
    setViewScale(1);
    expect(viewScaleVersion()).toBe(v0);
    setViewScale(0.6);
    expect(getViewScale()).toBe(0.6);
    expect(viewScaleVersion()).toBe(v0 + 1);
  });

  it("rejects nonsense scales", () => {
    setViewScale(0);
    expect(getViewScale()).toBeGreaterThan(0);
    setViewScale(Number.NaN);
    expect(Number.isFinite(getViewScale())).toBe(true);
  });
});

describe("bandVisible (hysteresis)", () => {
  const view = 100;
  const hyst = 15;
  it("shows inside the view distance and hides beyond view + hysteresis", () => {
    expect(bandVisible(false, 80, view, hyst)).toBe(true);
    expect(bandVisible(true, 130, view, hyst)).toBe(false);
  });

  it("keeps the previous state inside the hysteresis band (no flicker at the edge)", () => {
    expect(bandVisible(true, 108, view, hyst)).toBe(true);
    expect(bandVisible(false, 108, view, hyst)).toBe(false);
  });

  it("walking out and back in only toggles at the two thresholds", () => {
    let shown = false;
    const toggles: number[] = [];
    const path = [...Array.from({ length: 60 }, (_, i) => 70 + i), ...Array.from({ length: 60 }, (_, i) => 129 - i)];
    for (const d of path) {
      const next = bandVisible(shown, d, view, hyst);
      if (next !== shown) toggles.push(d);
      shown = next;
    }
    // Appears right away (70 < view), hides only past view + hysteresis, reappears under view.
    expect(toggles).toEqual([70, 116, 99]);
  });
});
