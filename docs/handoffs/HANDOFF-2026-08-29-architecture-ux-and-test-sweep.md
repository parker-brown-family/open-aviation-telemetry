# Handoff — Architecture UX, datum selector, compass rose, test sweep (2026-08-29)

## Status

**Landed and deployed.** Six commits, all pushed to `main`, CI green on every
job. Nothing uncommitted from this thread. The live page is serving a build of
the committed state — verified by comparing the bundle hash, not by assuming.

`HEAD` at tie-off is `7fd7b16`, which is **two commits past mine** — a
concurrent session added a credentials page and a certificate modal afterwards.
All six of my commits and every file they introduced were verified still
present.

| Commit | What |
|---|---|
| `6504348` | Diagram text fit + folio tabs with real code examples |
| `47f3274` | Connectors drawn border-to-border |
| `1555f50` | Test pass — pages 23% → 99%, +110 tests |
| `3280ba0` | Datum selector + ADR-0012 |
| `d2370f5` | Compass rose mark, generated favicon, 33 build steps |
| `0bb47df` | CI off the deprecated Node 20 action runtime |

## What's done

**Architecture explorer.** Box labels were overflowing because the code assumed
a 0.5em character advance; the font's real advance is 0.599em, so every width
estimate was ~20% short. `components/diagramText.ts` now holds measured
constants and its tests read `styles.css`, so the CSS and the maths cannot drift
apart. Connectors were drawn centre-to-centre and therefore ruled straight
through the boxes they point at — `components/edgeGeometry.ts` trims them
border-to-border using the blossom split of the quadratic, so the trimmed curve
follows exactly the original path. *Verified by mutation:* reverting the trim
failed exactly the two geometry assertions.

**Folio tabs on the detail panel.** Explanation | Examples, where the examples
are the actual code that implements the component, at the path and line numbers
it lives at, plus real captured responses badged as such.
`scripts/build-code-examples.mjs` slices every excerpt out of the repo at build
time by anchor string and fails loudly if an anchor moved. *Verified live in the
browser.*

**Datum selector.** Both fleet displays centre on any major airport rather than
only Kelowna. `regionAround()` in `shared/geo.ts` builds the window and widens
the longitude span by 1/cos(latitude) — otherwise the picture squashes by about
a third at 50°N and range rings render as ellipses pretending to be circles.
Two latent bugs surfaced and were fixed: airports outside the window were being
projected past the viewBox with labels sliced mid-glyph, and data blocks
overlapped once the fleet bunched into a corner. *Verified live, centred on
Calgary.*

**Compass rose + favicon.** The mark was a four-pointed star; it is now an
eight-point compass rose. There was no favicon at all — there is one now,
generated from the same geometry by `scripts/build-favicon.mjs`. *A test caught
a real drift immediately: I changed the colours and had not regenerated.*

**Training build steps.** 33 steps across 9 courses, each naming a change to
this repository that cannot be made without the material. Collapsible, a/b/c/d
labelled, X-and-strikethrough when done, empty box when not, whole row as the
click target. *Verified live.*

**Test sweep.** 230 → 418 unit/component tests. Pages went 23% → 99%, components
79% → 99%. The tests worth knowing about are the ones checking claims the code
makes about itself: the dashboard's "where these numbers came from" paragraph
(both branches pinned), the demo console's controls being *disabled* rather than
merely ineffective, the alerts rules table matching the processor's own
constants, and the route list in `build-static.sh` matching `App.tsx` in both
directions.

## How to run / verify

```bash
pnpm install
pnpm vitest run                    # 418 unit + component
pnpm -r typecheck && pnpm lint
pnpm format:check

make demo                          # full stack: Kafka, RabbitMQ, Postgres
make e2e                           # 27 tests against the real stack
make smoke                         # 9-stage pipeline proof
make down                          # tear down, removes volumes

# regenerate the committed artifacts (tests fail if these drift)
node scripts/build-code-examples.mjs
node scripts/build-favicon.mjs

# deploy
./scripts/build-static.sh /aircraft-telemetry/ dist-static
K=~/.piper-deploy/piper_deploy
rsync -az --delete -e "ssh -i $K -o IdentitiesOnly=yes" \
  dist-static/ root@100.102.188.106:/var/www/parker/aircraft-telemetry/
ssh -i $K -o IdentitiesOnly=yes root@100.102.188.106 \
  'chown -R 1000:1000 /var/www/parker/aircraft-telemetry'
```

Verify the deploy by comparing the live bundle hash to the local build rather
than by eye:

```bash
curl -s https://parker.brownfamilysports.com/aircraft-telemetry/ \
  | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js'
grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' dist-static/index.html
```

## Not done / next

- **[#17] The spatial `?near=` endpoint.** ADR-0012 argues this is the API-shaped
  work worth building — the counterpoint to the airport list, which is
  deliberately bundled. Bounding-box pre-filter, haversine refinement, an index,
  bounded radius, pagination.
- **[#18] Schema fidelity scope call.** Turbine Ng/ITT vs `engine.rpm`, dual
  altitude, four identifiers, two timestamps. **Likely closes `invalid`** — this
  repo demonstrates the pipeline, not avionics fidelity. Parker's call.
- **[ai-garrison#2] Hostname check** rejects `notebook.google.com`.
- **Garrison import still blocked on Parker** — needs a one-time interactive
  Google login; `~/.garrison/google-auth-state.json` does not exist.
  `cd ~/ai-garrison && bun run src/cli.ts assess "https://notebooklm.google.com/notebook/c4560b30-3eea-4bc8-9b0e-921b093da624"`
- **AWS never applied.** No credentials configured; `make tf-apply` would cost
  ~US$20–35/day. The Architecture page says `simulated` for exactly this reason.

## Watch out

- **Shared worktree.** Parker runs concurrent agent sessions against this same
  checkout. Never `git add -A`; stage by explicit path. Check `git status`
  before `Write` to any file you did not create this session — a `Write` to a
  path another session had just created destroyed eight of their tests here, and
  the only tell was `M` instead of `??`.
- **`telemetry-api` reads 0% in the coverage report.** That is not an untested
  API; it is covered by the e2e suite, which is deliberately outside
  `pnpm test` because it needs a running stack. Don't "fix" the number.
- **The sample-data banner is the feature, not a bug** (ADR-0010). The live page
  has no backend on purpose — the droplet is shared with silo CRM and
  stephbrownpt.
- **Never edit the main Caddyfile.** The deploy works because
  `build-static.sh` materialises each SPA route as a directory and the existing
  `try_files` finds them. Add a route to `App.tsx` and you must add it to
  `ROUTES` in that script — there is a test that fails if you don't.

## Where it's recorded

- APES episode: **none** — no APES project is registered for this repo and the
  SessionStart hook named none. Recommend creating one; see the tie-off report.
- lean-ctx: session `decision` breadcrumb recorded.
- file-memory: `skytrac-open-aviation-telemetry.md` (updated),
  `concurrent-agent-worktree-discipline.md` (new).
- Issues: #17, #18, `ai-garrison`#2 — all labelled `follow-up`.
