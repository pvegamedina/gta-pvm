import { describe, it, expect } from "vitest";
import { CHARACTER_IDS, DEFAULT_CHARACTER, characterForColor, randomCharacter, parseCharacterId, cycleCharacter, resolveCharacter, CHARACTER_NAMES } from "../characterChoice";
import { CHARACTER_IDS as SHARED_IDS } from "@shared/protocol";

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

describe("character selection helpers", () => {
  it("uses the canonical list from the shared protocol", () => {
    expect(CHARACTER_IDS).toBe(SHARED_IDS);
  });

  it("parses only known ids (e.g. from localStorage or the network)", () => {
    expect(parseCharacterId("swat")).toBe("swat");
    expect(parseCharacterId("dragon")).toBeNull();
    expect(parseCharacterId(null)).toBeNull();
    expect(parseCharacterId(3)).toBeNull();
  });

  it("cycles forwards and backwards with wrap-around", () => {
    const first = CHARACTER_IDS[0];
    const last = CHARACTER_IDS[CHARACTER_IDS.length - 1];
    expect(cycleCharacter(first, -1)).toBe(last);
    expect(cycleCharacter(last, 1)).toBe(first);
    expect(cycleCharacter(first, 1)).toBe(CHARACTER_IDS[1]);
  });

  it("lets an explicit choice win over the colour-derived default", () => {
    expect(resolveCharacter("punk", 0x123456)).toBe("punk");
    expect(resolveCharacter(null, 0x123456)).toBe(characterForColor(0x123456));
    expect(resolveCharacter("bogus", 0x123456)).toBe(characterForColor(0x123456));
  });

  it("has a Spanish display name for every character", () => {
    for (const id of CHARACTER_IDS) expect(CHARACTER_NAMES[id].length).toBeGreaterThan(0);
  });
});
