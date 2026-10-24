import { describe, expect, it } from "vitest";
import { HoldKey } from "../holdKey";

describe("HoldKey (tap vs long press)", () => {
  it("fires the hold action once after the threshold while still pressed", () => {
    const k = new HoldKey(0.5);
    k.press(10);
    expect(k.update(10.2)).toBe(false);
    expect(k.update(10.5)).toBe(true);
    expect(k.update(10.9)).toBe(false);
    expect(k.release(11)).toBe(false);
  });

  it("reports a tap when released before the threshold", () => {
    const k = new HoldKey(0.5);
    k.press(1);
    expect(k.update(1.3)).toBe(false);
    expect(k.release(1.3)).toBe(true);
  });

  it("ignores updates and releases without a press", () => {
    const k = new HoldKey(0.5);
    expect(k.update(5)).toBe(false);
    expect(k.release(5)).toBe(false);
  });

  it("re-arms for the next press and can be cancelled", () => {
    const k = new HoldKey(0.5);
    k.press(0);
    expect(k.update(0.6)).toBe(true);
    k.release(0.7);
    k.press(2);
    k.cancel();
    expect(k.update(3)).toBe(false);
    expect(k.release(3)).toBe(false);
  });
});
