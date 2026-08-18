# Campus terrain tiles

Elevation tiles the campus map shades from — hillshade in 2D, real terrain under
the buildings in 3D. **Generated, not hand-edited:** rerun
`npm run fetch:terrain -w @triton/web` (needs network) and commit the result.

| | |
| --- | --- |
| Source | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (Mapzen terrarium tiles on AWS Open Data, USGS-derived) |
| Licence | Public domain / CC-BY by contributing source — see https://github.com/tilezen/joerd/blob/master/docs/attribution.md |
| Fetched | 2026-08-18 |
| Encoding | terrarium (elevation m = R × 256 + G + B ÷ 256 − 32768) |
| Bounds | -117.3, 32.83 → -117.17, 32.93 (lon/lat) |
| Zooms | 13: 16, 14: 42 |
| Tiles | 58, 4.02 MB |

The planner never fetches elevation at runtime: these files ship with the site
and are served from its own origin, like the map glyphs and the campus geometry.
MapLibre overzooms the deepest level available, so z14 also covers z15–19.
