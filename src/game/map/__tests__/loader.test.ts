import { describe, expect, it } from "vitest";
import { CAMPUS_MAP_VERSION, type CampusMapFile } from "../types";
import { MapValidationError, fetchCampusMap, parseCampusMap } from "../loader";
import { encodeTerrainHeights } from "../terrain";

/** Smallest map that satisfies every invariant of the schema. */
function minimalMap(): CampusMapFile {
  return {
    version: CAMPUS_MAP_VERSION,
    name: "Test",
    attribution: ["© OpenStreetMap contributors (ODbL)"],
    projection: { originLat: 37, originLon: -6.9, metresPerDegLat: 111_000, metresPerDegLon: 88_700 },
    bounds: { minX: -4, minZ: -4, maxX: 4, maxZ: 4 },
    terrain: {
      originX: -4,
      originZ: -4,
      cellSize: 4,
      width: 3,
      height: 3,
      minHeight: 1,
      maxHeight: 9,
      encoding: "int16le-dm-base64",
      data: encodeTerrainHeights([1, 2, 3, 4, 5, 6, 7, 8, 9]),
    },
    campus: [],
    buildings: [
      {
        id: "w1",
        type: "yes",
        category: "university",
        height: 14,
        heightSource: "default",
        baseMin: 1,
        baseMax: 2,
        footprint: [
          [0, 0],
          [2, 0],
          [2, -2],
        ],
      },
    ],
    roads: [
      {
        id: "w2",
        class: "residential",
        width: 6.5,
        lanes: 2,
        oneway: false,
        surface: "asphalt",
        sidewalkOffset: 4.5,
        points: [
          [-3, 3],
          [3, 3],
        ],
      },
    ],
    graph: {
      nodes: [
        [-3, 3],
        [3, 3],
      ],
      roadEdges: [
        { from: 0, to: 1, road: 0, i0: 0, i1: 1, length: 6 },
        { from: 1, to: 0, road: 0, i0: 1, i1: 0, length: 6 },
      ],
      footEdges: [{ from: 0, to: 1, road: 0, i0: 0, i1: 1, length: 6, offset: 4.5 }],
    },
    landuse: [
      {
        kind: "grass",
        area: 2,
        points: [
          [0, 0],
          [2, 0],
          [2, -2],
        ],
      },
    ],
    trees: [{ x: 1, z: 1, species: "palm" }],
    spawns: [{ x: 0, z: 2, yaw: 0, near: "Edificio" }],
    trafficLights: [{ x: 3, z: 3, nodes: [1] }],
  };
}

const roundTrip = (m: unknown): unknown => JSON.parse(JSON.stringify(m));

describe("parseCampusMap", () => {
  it("accepts a valid map and decodes the terrain", () => {
    const map = parseCampusMap(roundTrip(minimalMap()));
    expect(map.buildings).toHaveLength(1);
    expect(map.terrainGrid.heights).toHaveLength(9);
    expect(map.terrainGrid.heights[4]).toBeCloseTo(5);
  });

  it("accepts a JSON string", () => {
    expect(parseCampusMap(JSON.stringify(minimalMap())).spawns).toHaveLength(1);
  });

  const cases: [string, (m: CampusMapFile) => void, RegExp][] = [
    ["wrong version", (m) => ((m as { version: number }).version = 99), /version/],
    ["missing buildings", (m) => delete (m as Partial<CampusMapFile>).buildings, /buildings/],
    ["footprint with < 3 points", (m) => m.buildings[0].footprint.splice(1), /buildings\[0\]\.footprint/],
    ["non-finite coordinate", (m) => (m.roads[0].points[1][0] = Number.NaN), /roads\[0\]\.points\[1\]/],
    ["unknown road class", (m) => ((m.roads[0] as { class: string }).class = "spaceway"), /roads\[0\]\.class/],
    ["edge pointing to a missing node", (m) => (m.graph.roadEdges[0].to = 7), /graph\.roadEdges\[0\]/],
    ["edge point index out of the road", (m) => (m.graph.roadEdges[0].i1 = 5), /graph\.roadEdges\[0\]/],
    ["unknown tree species", (m) => ((m.trees[0] as { species: string }).species = "baobab"), /trees\[0\]\.species/],
    ["no spawn points", (m) => (m.spawns = []), /spawns/],
    ["truncated terrain", (m) => (m.terrain.data = m.terrain.data.slice(0, 8)), /terrain/],
  ];

  for (const [label, mutate, message] of cases) {
    it(`rejects ${label}`, () => {
      const m = roundTrip(minimalMap()) as CampusMapFile;
      mutate(m);
      // NaN does not survive JSON, so mutate after the round trip.
      expect(() => parseCampusMap(m)).toThrow(MapValidationError);
      expect(() => parseCampusMap(m)).toThrow(message);
    });
  }

  it("rejects non-object input and invalid JSON", () => {
    expect(() => parseCampusMap(42)).toThrow(MapValidationError);
    expect(() => parseCampusMap("{not json")).toThrow(MapValidationError);
  });
});

describe("fetchCampusMap progress", () => {
  /** A fetch stub streaming `text` in `chunks` pieces, with or without Content-Length. */
  function streamingFetch(text: string, chunks: number, withLength: boolean): typeof fetch {
    const bytes = new TextEncoder().encode(text);
    const size = Math.ceil(bytes.length / chunks);
    return (async () => {
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (i * size >= bytes.length) return ctrl.close();
          ctrl.enqueue(bytes.slice(i * size, (i + 1) * size));
          i++;
        },
      });
      const headers = withLength ? { "content-length": String(bytes.length) } : undefined;
      return new Response(body, { status: 200, headers });
    }) as unknown as typeof fetch;
  }

  it("reports monotonic progress up to 1 and still parses the map", async () => {
    const seen: number[] = [];
    const map = await fetchCampusMap("x", streamingFetch(JSON.stringify(minimalMap()), 5, true), (f) => seen.push(f));
    expect(map.spawns).toHaveLength(1);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen.at(-1)).toBe(1);
  });

  it("estimates progress below 1 without a Content-Length, then reports 1 at the end", async () => {
    const seen: number[] = [];
    await fetchCampusMap("x", streamingFetch(JSON.stringify(minimalMap()), 4, false), (f) => seen.push(f));
    expect(seen.slice(0, -1).every((f) => f < 1)).toBe(true);
    expect(seen.at(-1)).toBe(1);
  });
});
