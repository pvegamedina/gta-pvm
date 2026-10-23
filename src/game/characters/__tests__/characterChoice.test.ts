import { describe, it, expect } from "vitest";
import { CHARACTER_IDS, DEFAULT_CHARACTER, characterForColor, randomCharacter } from "../characterChoice";

describe("characterForColor", () => {
  it("falls back to the default character before the server assigns a color", () => {
    expect(DEFAULT_CHARACTER).toBe("casual_hoodie");
    expect(characterForColor(null)).toBe(DEFAULT_CHARACTER);
    expect(characterForColor(undefined)).toBe(DEFAULT_CHARACTER);
    expect(characterForColor(Number.NaN)).toBe(DEFAULT_CHARACTER);
  });

  it("is deterministic so every client picks the same model for a player", () => {
    const color = 0x3fa9e2;
    expect(characterForColor(color)).toBe(characterForColor(color));
  });

  it("maps consecutive colors onto every character", () => {
    const picked = new Set(CHARACTER_IDS.map((_, i) => characterForColor(0x40c080 + i)));
    expect(picked.size).toBe(CHARACTER_IDS.length);
  });

  it("always returns a known character, even for odd inputs", () => {
    for (const c of [0, 1, 7, 8, 0xffffff, -5, 12.7]) {
      expect(CHARACTER_IDS).toContain(characterForColor(c));
    }
  });
});

describe("randomCharacter", () => {
  it("uses the injected random source", () => {
    expect(randomCharacter(() => 0)).toBe(CHARACTER_IDS[0]);
    expect(randomCharacter(() => 0.9999)).toBe(CHARACTER_IDS[CHARACTER_IDS.length - 1]);
  });
});
