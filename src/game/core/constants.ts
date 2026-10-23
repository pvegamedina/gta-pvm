// World layout constants — mirrors shared/protocol.ts SPAWN_POINTS layout exactly
// (G=6 blocks, BLOCK=60, ROAD=18) so client geometry and server spawn points agree.

export const G = 6;
export const BLOCK = 60;
export const ROAD = 18;
export const P = BLOCK + ROAD;
export const HALF = ROAD / 2;
export const LANE = 4.5;
export const WORLD = (G * P) / 2 + HALF;
export const LIMIT = WORLD + 25;
export const STOPD = 15.8;
export const STEP = 1 / 60;
export const TOD_SPEED = 24 / 480;

export const rc = (i: number): number => (i - G / 2) * P;
export const bc = (i: number): number => (i + 0.5 - G / 2) * P;

export const SPECIAL: Record<string, "park" | "plaza" | "lot"> = {
  "1,1": "park",
  "4,4": "park",
  "0,4": "park",
  "5,1": "park",
  "2,3": "plaza",
  "3,2": "lot",
};

export const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const inR = (i: number, j: number): boolean => i >= 0 && i <= G && j >= 0 && j <= G;
