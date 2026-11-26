# San Francisco map sources

© OpenStreetMap contributors (ODbL). The map data and derived geometric database retain the Open Database License 1.0. [OpenStreetMap copyright and licence](https://www.openstreetmap.org/copyright)

The main extract covers latitude 37.798–37.808 and longitude −122.450–−122.433. A smaller water request supplies the Palace lagoon multipolygon and the yacht harbours. Both were downloaded from the OSM-listed North America Overpass mirror at `https://ovp.dresel.systems/api-na/interpreter`. Exact requests, timestamps and hashes are recorded in `provenance.json` and `water.provenance.json`.

The published source responses preserve the returned geometry, tags needed for navigation and relation members. The release process removes mapper identity metadata and contact, telephone, email and website tags. The first response contained three email-valued tags within 35 removed contact fields. Its byte-exact original remains in the ignored local working folder. Source hashes distinguish the original bytes from the sanitized public responses.

## Reproduce

From the repository root, run these commands through the shared machine queue.

```sh
heavy node tools/fetch-sf-map.mjs
heavy node tools/compile-sf-map.mjs
```

The fetcher makes two bounded GET requests. The compiler reads `corridor.overpass.json` and `water.overpass.json`, writes `public/data/sf/world.json`, and records direction, access, control and turn proofs in `route-audit.json`. The compiled scene uses metres with x east and z south, around latitude 37.80418, longitude −122.44849.

## Route

The start is on Chestnut Street about 30 m east of Fillmore. The westbound departure crosses the mapped signal at Fillmore, then turns right onto Divisadero and left onto Marina Boulevard. The arrival turns left onto Baker, right onto Bay and right onto Palace Drive. It follows Palace Drive around the west side of the lagoon, then turns right into parking access way 562765651 and reaches parking aisle 68914563 inside lot polygon 68914570.

The short Lyon link 8915480 runs northbound toward eastbound Marina. The route uses the longer public approach to preserve its one-way direction. The audit checks every traversed way for access and direction, every way transition against applicable node restrictions, and all extracted via-way restrictions against the complete traversal.

OSM gives part of Chestnut a 20 mph limit and Marina a 25 mph limit. The demo brief asks for a 25 mph street limit. The runtime records that presentation choice separately from the source data.

## Geometry and assumptions

Roads and building footprints come from a corridor of approximately 150 m on each side of the driven centreline. Full intersecting footprints are retained. Road widths use mapped width tags where present, otherwise 3.2 m per lane and 2.2 m per mapped parking lane. Missing building heights use mapped storeys or a 3.2 m storey estimate. Missing controls at genuine street junctions become all-way stops as required by the demo brief. The audit counts each inference.

The rotunda is building way 288371295. The Palace lagoon is water multipolygon relation 7471537. Yacht Harbor and East Harbor are ways 453930841 and 453933178. Those complete water polygons also support distant views beyond the street corridor. An unrelated inland water polygon is excluded.

The derived runtime file contains street names and public landmark names. Commercial flags come from building type and proximity to Chestnut. Shop names, logos, contacts and operator names are omitted. Building relation outlines currently omit interior courtyard holes.

Wikimedia look photographs are local references in the external reference folder. Their `sources.md` records authors and licences. The Marina Boulevard photograph is daylight. The bridge night photograph was taken nearby at Crissy Field. Their location and lighting caveats remain with the sources.
