# ADR-0011: Two fleet views — a terrain basemap, falling back to a self-contained scope

**Status:** Accepted — supersedes part of the reasoning in
[ADR-0006](0006-synthetic-telemetry.md)

## Context

The fleet display started as a single view: an equirectangular projection into
an SVG viewBox, drawing a graticule, range rings, airports and targets, with no
tiles and no network calls. The argument for it was demo safety, and it is a
good argument — the view renders identically offline and cannot fail because a
CDN is slow.

It is also, plainly, a worse picture. Aircraft over the BC interior are flying
over the Coast Mountains and the Rockies, and a blank olive grid says nothing
about that. Terrain and place names are not decoration here; they are what make
the display legible as _aviation_ rather than as dots on a plane.

So the question is not which view is better. It is whether the better picture is
worth a runtime dependency on two third-party tile CDNs.

## Decision

Ship both, and make the fallback automatic.

**Map** is the default: Leaflet, with an Esri dark hillshade underneath and a
CARTO dark raster on top — the same pair
`parker.brownfamilysports.com/map` uses, so the two surfaces look related.
Targets are coloured by altitude band and hovering one raises a tactical card.

**Scope** is the original SVG plan view, unchanged: no tiles, no network.

The switch is manual, but the failure path is not. `TacticalMap` watches for the
first successful `tileload`; if none arrives within six seconds it reports the
basemap unavailable, `FleetView` drops to the scope and says why, and the Map
button is disabled so it cannot be chosen back into a grey rectangle.

The dashboard keeps the scope unconditionally. It is a summary at a glance, it
sits above the fold on the page most likely to be opened first, and it should
never wait on a tile.

## Why watch for success rather than listen for errors

Leaflet emits `tileerror` per failed tile, which is the obvious hook and the
wrong one: a blocked or captive-portalled network frequently produces no error
at all, because the requests simply hang. Nothing fires, and the view sits
empty forever.

Watching for the first `tileload` inverts that: the absence of success is the
signal, and it catches every failure mode — blocked, hung, DNS-poisoned, offline
— rather than only the ones polite enough to return an error.

## Consequences

- The demonstration gets the good picture, and still cannot be broken by the
  room's wifi. Both, rather than a choice between them.
- Two tile providers are now runtime dependencies of the default view, and both
  require attribution, which the map renders.
- The claim "the map draws no tiles", which appeared in the README, the
  Architecture Explorer, the demo runbook and two source comments, was true and
  is now only true of the scope. All of it has been corrected — a stale
  architectural claim is worse than none, because a reader has no way to know
  which parts still hold.
- Markers are created once and moved, never recreated per poll. Recreating a
  hundred markers every two seconds is the thing that makes a live map stutter,
  and it is not obvious until the fleet is large.
- Leaflet is a real dependency (about 150 kB). The scope has none, which is
  another reason to keep it rather than delete it once the map works.

## Alternatives considered

**Map only, no fallback.** Simplest, and the one that fails in the room.

**Self-hosted tiles.** Removes the dependency entirely and keeps the terrain.
Rejected for now on size: a usable raster pyramid for this region at these zooms
is hundreds of megabytes, which is not something to put in a repository whose
point is that it is easy to clone and run. A vector basemap with a self-hosted
style would be the right answer if this outgrew a demo.

**A React wrapper for Leaflet.** The wrappers exist to make Leaflet declarative,
and the cost lands exactly where this component needs imperative control — every
marker moving on a two-second poll. Using Leaflet directly is less idiomatic
React and considerably less code here.

## Related

- [ADR-0010](0010-honest-data-provenance.md) — saying what the display is showing
