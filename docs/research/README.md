# Research: where this telemetry model is wrong

A convergence run over 21 difficult-case families in aircraft telemetry, done to
check this project's modelling assumptions against real standards before the
schema hardened. Produced with
[research-delight](https://github.com/parker-brown-family) — a harness where the
definition of done is declared up front per field, and a value with no source
does not count.

|            |                                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subjects   | 21, across 8 clusters                                                                                                                                                 |
| Result     | 21/21 complete, mean 100%, one round                                                                                                                                  |
| Bubble-ups | 8 (4 serendipity, 2 gap-notes, 2 spec-suggestions)                                                                                                                    |
| Rule       | `real_encoding` and `standard` were **source-required** — bit widths, ranges and units are exactly what a model confabulates fluently, so no citation meant no credit |

- **[telemetry-difficult-cases.md](telemetry-difficult-cases.md)** — the full findings
- **[The Research tab in the console](https://parker.brownfamilysports.com/aircraft-telemetry/research)**
  — the same findings as a page in the app: one collapsible card per case, each
  value tagged with how well it is sourced. Built from the artefacts here by
  `make research-data`, so the page cannot drift from the run
- [telemetry-difficult-cases.html](telemetry-difficult-cases.html) — the raw generated page
- [telemetry-difficult-cases.csv](telemetry-difficult-cases.csv) — for a spreadsheet
- [run.json](run.json) — scores, gaps and provenance for every field

## What it found

The dominant failure mode in telemetry modelling is not bad logic. It is a
schema that cannot represent the domain — and that recurred often enough across
independent subjects that the harness raised it as a spec-suggestion of its own.

**This project's engine model is wrong for turbine aircraft.** `engine.rpm` with
a 0–6000 range and an 1800–2700 airborne band is piston-engine intuition. A
turboprop reports gas generator speed as a _percentage_ of a reference — 100% Ng
is about 37,500 rpm on a PT6A-27 — plus propeller speed, torque as a differential
oil pressure, and ITT, which is the parameter that actually limits the engine and
has no field at all. Not a units bug: the modelled quantity does not exist.

**Altitude is two quantities.** ADS-B carries barometric altitude and GNSS height
above ellipsoid in _different message types_, and a published study found them
differing by 25–1,325 ft, averaging 569 ft. One `altitude_ft` column forces a
choice at ingest that ingest is not qualified to make.

**An aircraft identifier is not one field.** ICAO 24-bit address, registration,
callsign and flight number change on different timescales for different reasons.
Keying on the tail number — the one a human would use — is keying on the least
stable of the four.

**Two timestamps, not one.** Iridium SBD latency runs about 5 s at 70 bytes to
20 s at the 340-byte maximum, so time of applicability and time of receipt are
genuinely different. Ordering by receipt makes an aircraft jump backwards along
its own track after a link outage.

**A regulatory date that has already moved twice.** The GADSS one-minute distress
tracking requirement is widely published as 2021. It was postponed to 2023, and
as adopted applies from 1 January 2025 to aeroplanes over 27,000 kg certificated
on or after 1 January 2024. Anything quoting 2021 is repeating superseded
trade-press coverage.

## What it deliberately did not claim

Two gap-notes record what could not be sourced, rather than filling it in:

- The **DO-260B NIC/NACp/SIL value tables** are behind a paid standard. Public
  sources confirm they live in §2.2.3 and describe what the categories mean, but
  do not reproduce the integer-to-containment-radius mapping. Quoting specific
  radii from memory is exactly the confabulation the source-required rule exists
  to prevent.
- **ARINC 429 label numbers for magnetic versus true heading** likewise. The
  structural claim — that units, resolution and range are fixed per label, so the
  two headings are distinct labels — is sourced. The label numbers are not, and
  were therefore not asserted.

## Reproducing it

```bash
cd ../research-delight
bun run bin/research-delight.ts run examples/aircraft-telemetry.plan.ts \
  --out runs/aircraft-telemetry
```

The plan and the reusable `telemetry-cases` rubric live in that repository. The
rubric is domain-agnostic: swap the subjects and it asks the same question —
_where is my model wrong, what breaks because of it, and what does a real system
do instead_ — of any data domain.
