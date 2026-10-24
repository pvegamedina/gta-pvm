# Campus El Carmen — raw map data

Inputs for `npm run map:build` (scripts/map), which generates `public/maps/campus-el-carmen.json`.

| File | Source | Licence / attribution |
|---|---|---|
| `osm.json` | OpenStreetMap via Overpass API, bbox S 37.2647, W -6.9299, N 37.2763, E -6.9167 (campus way 127717781 + ~150 m margin), downloaded 2026-10-24 | ODbL 1.0 — © OpenStreetMap contributors (https://www.openstreetmap.org/copyright) |
| `mdt05.tif` | IGN MDT05 (5 m DTM) via WCS `https://servicios.idee.es/wcs-inspire/mdt`, coverage `Elevacion4258_5`, same bbox, EPSG:4258, int16 metres, downloaded 2026-10-24 | CC BY 4.0 — © Instituto Geográfico Nacional de España |

Overpass query:

```
[out:json][timeout:120];(way(37.2647,-6.9299,37.2763,-6.9167);node(37.2647,-6.9299,37.2763,-6.9167)[natural=tree];relation(37.2647,-6.9299,37.2763,-6.9167)[building];relation(37.2647,-6.9299,37.2763,-6.9167)[type=multipolygon];);out body;>;out skel qt;
```

GeoTIFF facts: 293 × 257 px, pixel ≈ 4.505e-5° lon × 4.514e-5° lat, tiepoint (-6.9299, 37.2763) top-left, values 2–32 m.
