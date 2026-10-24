// CLI: `npm run map:build`
// Reads data/campus/{osm.json,mdt05.tif} and writes public/maps/campus-el-carmen.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildCampusMap } from "./pipeline";

const root = path.resolve(import.meta.dirname, "../..");
const outFile = path.join(root, "public/maps/campus-el-carmen.json");

async function main(): Promise<void> {
  const osm = JSON.parse(readFileSync(path.join(root, "data/campus/osm.json"), "utf8")) as unknown;
  const demBytes = new Uint8Array(readFileSync(path.join(root, "data/campus/mdt05.tif")));
  const { json, stats } = await buildCampusMap({ osm, demBytes });
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, json, "utf8");
  console.log(`Wrote ${path.relative(root, outFile)} (${(stats.bytes / 1024).toFixed(1)} KiB)`);
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
