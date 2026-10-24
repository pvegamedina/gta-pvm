import { describe, expect, it } from "vitest";
import { createPlaceTracker, updateBuildingName, updateStreetName, STREET_CONFIRM } from "../placeNames";

describe("updateStreetName", () => {
  it("announces the first named street once the player has been on it for a moment", () => {
    const t = createPlaceTracker();
    expect(updateStreetName(t, { name: "Avenida de las Artes", excess: 1 }, 0.1)).toBeNull();
    expect(updateStreetName(t, { name: "Avenida de las Artes", excess: 1 }, STREET_CONFIRM)).toBe("Avenida de las Artes");
    // Staying on it never repeats the toast.
    for (let i = 0; i < 20; i++) expect(updateStreetName(t, { name: "Avenida de las Artes", excess: 0.5 }, 0.2)).toBeNull();
  });

  it("ignores brief brushes with a side street (hysteresis) and far-away roads", () => {
    const t = createPlaceTracker();
    updateStreetName(t, { name: "Calle A", excess: 0 }, STREET_CONFIRM + 0.01);
    expect(updateStreetName(t, { name: "Calle B", excess: 0.5 }, STREET_CONFIRM / 3)).toBeNull();
    expect(updateStreetName(t, { name: "Calle A", excess: 0.5 }, 0.1)).toBeNull();
    // The candidate timer restarted: another short brush is still not enough.
    expect(updateStreetName(t, { name: "Calle B", excess: 0.5 }, STREET_CONFIRM / 3)).toBeNull();
    // Too far from the carriageway to count as being on it.
    expect(updateStreetName(t, { name: "Calle C", excess: 9 }, 5)).toBeNull();
  });

  it("announces a new street after the confirmation time, and the old one again when coming back", () => {
    const t = createPlaceTracker();
    updateStreetName(t, { name: "Calle A", excess: 0 }, STREET_CONFIRM + 0.01);
    expect(updateStreetName(t, { name: "Calle B", excess: 0 }, STREET_CONFIRM + 0.01)).toBe("Calle B");
    expect(updateStreetName(t, null, 3)).toBeNull();
    expect(updateStreetName(t, { name: "Calle A", excess: 0 }, STREET_CONFIRM + 0.01)).toBe("Calle A");
  });
});

describe("updateBuildingName", () => {
  const entrances = [
    { name: "Facultad de Derecho", x: 0, z: 0 },
    { name: "Biblioteca Central", x: 100, z: 0 },
  ];

  it("names a building when the player walks up to its entrance, once per visit", () => {
    const t = createPlaceTracker();
    expect(updateBuildingName(t, entrances, 30, 0)).toBeNull();
    expect(updateBuildingName(t, entrances, 6, 2)).toBe("Facultad de Derecho");
    expect(updateBuildingName(t, entrances, 4, 1)).toBeNull();
    // Leaving well away and coming back announces it again.
    updateBuildingName(t, entrances, 50, 0);
    expect(updateBuildingName(t, entrances, 3, 0)).toBe("Facultad de Derecho");
    expect(updateBuildingName(t, entrances, 97, 1)).toBe("Biblioteca Central");
  });
});
