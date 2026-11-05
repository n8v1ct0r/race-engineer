# AI Race Engineer: Phase 1 plan

Status: **Approved by Nate on 2026-09-23.** Phase 2 in progress.

Decisions recorded (Nate's answers, 2026-09-23):
- D0 + D1 + D4: **Tolerance, kept small.** Real F1 sessions are exported locally; 0 F1-derived files in git; code writes template notes on F1 laps; Claude writes notes only on synthetic and Photoncar laps; the public deploy is decided at Phase 6.
- D5: **"AI Race Engineer" + F1 context.** No F1 mark in the product or repo name; F1 in the tagline, URL paths, topics, Grand Prix names, 2026 season first.
- D2: **4 sessions:** 2026 Hungary Q, 2025 Japan Q, 2025 Saudi Arabia Q, 2026 Spain (Madrid) Q.
- D3: **All 4 dependencies approved:** uplot, vitest + vite, ajv, @anthropic-ai/sdk. Plan approved; start Phase 2.
Date: 2026-09-23. Evidence: 7 research agents plus 2 verifiers. Every number below comes from a command they ran or a page they read. Raw results live in the session scratchpad, not in this repo.

Decision brief: private.

Legend: **FACT** (measured or quoted), **INFERENCE** (reasoned), **UNKNOWN**, **[P]** (a proposed default for Nate to set).

## 0. Decisions Nate needs to make

| # | Decision | Recommendation |
|---|---|---|
| D0 | Stance on real F1 data. Read plainly, F1's terms do not permit this project in public (section 1). Every FastF1-based project runs on F1's tolerance. | If Nate wants F1 in it: proceed on tolerance with exposure kept small. That means a local export, 0 F1-derived files in git, non-commercial, a clean name (D5), template notes on F1 laps (D1), and the public deploy decided at Phase 6. The strict alternative is synthetic and Photoncar laps only. |
| D1 | Claude notes on Formula 1 laps, given F1's AI clause (section 1) | B: code writes template notes for F1 laps; Claude writes notes for synthetic laps now and Photoncar laps later. Optionally ask F1 for written permission at the same time (A). |
| D2 | Sessions for the MVP (section 8) | N = 4: 2026 Hungary Q, 2025 Japan Q, 2025 Saudi Arabia Q, 2026 Spain (Madrid) Q |
| D3 | Unlisted dependencies (section 10) | Approve `uplot`, `vitest` + `vite`, `ajv`. Approve `@anthropic-ai/sdk` or accept a plain-fetch client. |
| D4 | Keep F1-derived data out of git | Yes. Everything in the public repo builds and tests on a synthetic lap. |
| D5 | Name: Nate asked for "AI F1 Race Engineer" (section 1a) | Keep the product name "AI Race Engineer" and put F1 into everything that describes it, as the Guidelines allow: tagline, repo description, URL paths, topics, real Grand Prix context, 2026 season first. |

Resolved without asking (routine, reversible): `[GITHUB USER]` = `n8v1ct0r` (gh is signed in as n8v1ct0r). `[LICENSE]` = MIT. `[25]` mini-sectors = 25. Default git email is the GitHub-verified default email, so commit metadata carries no stealth term.

## 1. Data source terms

This is not legal advice. Four points need a lawyer's read, listed at the end of this section.

| Source | What we use | Terms | Risk |
|---|---|---|---|
| F1 live timing (livetiming.formula1.com), read by FastF1 | Lap times, car telemetry, position | formula1.com Legal Notices and the Formula 1 Guidelines. All rights reserved. No open license. | **High** |
| FastF1 3.8.3 | Python client | MIT (code only). Pin `fastf1==3.8.3`. Never edit its rate limits. | Low |
| Jolpica-F1 (api.jolpi.ca), called by FastF1 | Results, race lap 1 times | Data CC BY-NC-SA 4.0. Custom User-Agent required. 4 req/s, 500 req/h. | Medium |
| MultiViewer (api.multiviewer.app), called by FastF1 | Corner numbers | No published terms. robots.txt disallows all. Store only corner labels plus our own computed distances. | Low |
| FastF1 schedule files | Event names | "Use as you like." | Low |
| OpenF1 (later option) | Not used yet | CC BY-NC-SA 4.0. Free historical data from 2023. Free tier 3 req/s, 30 req/min, labeled "Personal use". | Medium |
| F1 TV sign-in (FastF1 live client) | Never used | Its terms limit data to private viewing. The export must not call it. | Low if unused |

Key clauses (FACT, quoted from formula1.com, read 2026-09-23; see verifier result in section 11):

- Guidelines, timing data: "Individual pieces of the data can be used incidentally within editorial material to genuinely inform but substantial pieces of the data may not be reproduced or used commercially through scraping or any other means."
- Guidelines, AI: "The FORMULA 1 Rights cannot be used for text and data mining and in or with any artificial intelligence technology, including in connection with training; development; or operation of large language models ... without an express licence from the Formula 1 companies." FORMULA 1 Rights include "Results and Timing data" and "Statistics".
- Legal Notices: materials including "live timing data, historical race data" are protected; no copying, republishing, uploading or distributing "without our prior written consent."
- Required fan-site disclaimer, in the home page footer: "This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V."
- Fonts: F1 header typefaces are never allowed, and Titillium Web must not be used to suggest an association.

An adversarial verifier re-fetched every quote on 2026-09-24 UTC: 6 of 7 claims were confirmed verbatim; the OpenF1 license claim is only partly supported. It also found three restrictions the first pass missed (FACT, verbatim):

- F1 Digital Products Terms of Use ("Last Updated: August 2025"): "You shall not conduct, facilitate, authorise or permit any text or data mining or web scraping in relation to" the Digital Products, and no automated tool may access "any data ... accessed via" them "for any purpose". FastF1's maintainer says the livetiming API powers the F1 app, and that all non-Ergast FastF1 calls hit these endpoints (Discussion #780, 2025-08-25). UNKNOWN: whether livetiming.formula1.com counts as a Digital Product.
- Guidelines: "Other Intellectual Property Rights cannot be used in apps."
- Guidelines, education: "this does not include public postings such as YouTube, websites and social media."

No counter-evidence turned up: no carve-out for fans, non-commercial use or derived statistics. The only fan text is discretionary ("We endeavour to take a more relaxed approach"). The cease-and-desist reports the verifier found target people using the F1 name for branding, not data projects (UNKNOWN beyond its searches). The FastF1 maintainer says community use "depends on F1's good will" and that bulk redistribution "should be considered as not allowed except probably in some special cases."

Bottom line (D0): a strict reading of hard rule 5 rules out real F1 data in public, and arguably the export step too. The realistic path, the one FastF1, OpenF1 and every fan telemetry site take, is tolerance with small exposure. Only Nate can choose that knowingly.

What this means for the plan:

1. **Commit 0 files of F1-derived data.** `public/data/` (exported sessions, served at `/data/`) and the FastF1 cache are gitignored. The repo commits code, `lap-schema.json`, and a synthetic lap pair made by a stdlib script. CI, the Python parity test, schema validation, the note check and the site's demo state all run on the synthetic pair.
2. **Never generate data at build time.** It would serve the same data, add 13 upstream requests per fresh session load and 25.7 to 35.9 s of cold export per chosen session (measured by the sessions agent) to every build, and break when upstream is down.
3. **D1: Claude notes on F1 laps.** Sending timing-derived numbers to Claude reads as "operation of large language models" under the AI clause, even locally. Hard rule 5 says follow the terms. Options: A) email brandprotection@f1.com for written permission; **B) (recommended)** code writes the notes for F1 laps from templates built only from computed display strings, so rules 3 and 4 still hold, while Claude writes notes for synthetic laps now and Photoncar laps later; C) ship as briefed and accept the risk. A and B can run together. The pipeline (insight JSON, model route, validator, cache, limits) is built and tested in full under every option.
4. **Public deploy (Phase 6) is a separate call.** Serving per-lap telemetry to browsers is reproduction on a plain reading. If Nate deploys: prebuilt from the local machine, only the N sessions, lap-schema fields only, 0 commercial elements, a removal-request path via GitHub issues.
5. **Export script hygiene.** Custom User-Agent for Jolpica (`race-engineer-export/0.1.0 FastF1/3.8.3`). Never use F1 TV sign-in. Fetch each session once and reuse the cache (1 fresh session load = 13 requests; 500 req/h cap allows 38 fresh loads per hour). Write a provenance block per session (FastF1 version, export date, hosts, whether the livetiming mirror was used, which fields came from Jolpica).
6. **Copy.** Keep "Unofficial. Not affiliated with Formula 1." on every page, exactly as briefed, and add F1's full disclaimer to the home page footer and README. Never put "F1" first in a title. Show short event names, never `OfficialEventName` (it carries sponsor names).
7. **Portfolio screenshots (Phase 4)** show charts from real laps. INFERENCE: this is closer to "incidental editorial" use than publishing the data, but it is still F1-derived. Revisit at Phase 4.

### 1a. Naming and the F1 tie-in (D5)

Nate asked (2026-09-23) to call the project "AI F1 Race Engineer" and to tie it into F1. The Guidelines rule on the name directly (FACT, formula1.com Guidelines text saved 2026-09-23):

- "Our Marks cannot be used or registered as part of a company name, trade name, product name, service name, social media name and/or handle nor can they be used or registered in any trade mark or service mark."
- Fundamental principles: "not integrate Our Marks into any other marks and sufficiently differentiate the use of Our Marks from other marks".
- "we allow the Permitted Word Marks to be used to inform, not to brand."
- Apps: word marks may be used "in the paragraphs of accompanying text to describe the app."

So "AI F1 Race Engineer" as the product name, the repo name or the page title is the one use the Guidelines single out as not allowed. Hard rule 5 says follow the terms, so the recommendation keeps the name and ties in F1 everywhere the Guidelines permit:

| Where | What | Guideline basis |
|---|---|---|
| Name | "AI Race Engineer" (repo `race-engineer`) | No mark in a product name |
| Tagline and repo description | "Formula 1™ qualifying laps, compared corner by corner." | Attributive modifier ("Formula 1 qualifying laps"); Title Case with ™ in headlines |
| URL paths | `race.nate-victor.com/f1/2026/hungary/q` | Marks allowed "after a domain name as a sub-resource", never as a subdomain (`f1.nate-victor.com` is out) |
| GitHub topics | `formula1`, `f1`, `fastf1`, `telemetry` | Non-commercial hashtags allowed |
| Session picker | Grand Prix names in BLOCK CAPITALS, for example "HUNGARIAN GRAND PRIX 2026"; no sponsor titles | Event titles in BLOCK CAPITALS; sentence case everywhere else |
| Content | Real 2026 sessions first, Q1/Q2/Q3 segments, official sector splits, tyre compound and age per lap, deleted laps with reason, yellow-flag laps flagged, teammate comparison (same car) | Editorial use of the data, within section 1 |
| Freshness | Add 2026 Azerbaijan qualifying (round 15, scheduled 2026-09-25) once FastF1 publishes it (usually 30 to 120 min after a session) | Same |
| About page | The 2026 rules in the data: no DRS channel in 2026 telemetry (FastF1 fills 0); top speed 336 km/h in 2026 Hungary Q vs 319 km/h in 2025 (one driver each) | Editorial |
| Voice | Notes in team-radio style | No mark needed |
| Never | "F1" in the name, logos, the official typeface or Titillium Web, team livery, "F1" as the first word of any title, "F1" as a noun or possessive | Guidelines and hard rule 1 |

If Nate still wants "F1" in the name, that is his call to make knowingly. It conflicts with hard rule 5, it is the easiest thing for a rights holder to object to, and a takedown would hit the repo and the site together.

Lawyer's read needed on: whether the Legal Notices bind someone who only fetches livetiming JSON through a library; whether code-computed deltas are still "Timing data" or "Statistics"; how UK and EU database rights reach a US non-commercial site; whether a portfolio that helps win client work counts as non-commercial (CC BY-NC-SA) and not "materially commercial" (F1 fan rules).

## 2. Lap schema

One schema, `lap-schema.json`, JSON Schema 2020-12. Columnar arrays (one array per channel) because they are 49.7% smaller than row objects and map directly onto chart series. The field names match Photoncar `lap.v0` exactly (`t_ms, dist_m, speed_kph, throttle_pct, brake, gear, rpm, x, y`), so Photoncar moves to v1 by renaming `schema`, moving its `source` and `line_id` into `meta`, and adding `origin` and `track_id`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/n8v1ct0r/race-engineer/blob/main/lap-schema.json",
  "title": "Lap",
  "description": "One lap as parallel arrays. Every array in samples has the same length and t_ms strictly increases (checked by scripts/validate-laps.ts, since JSON Schema cannot compare arrays). Units are in the field names. x and y are meters in any fixed, flat frame for that track.",
  "type": "object",
  "additionalProperties": false,
  "required": ["schema", "origin", "track_id", "lap_no", "duration_ms", "valid", "samples"],
  "properties": {
    "schema": { "const": "race-engineer.lap/v1" },
    "origin": { "enum": ["fastf1", "synthetic", "photoncar"] },
    "track_id": { "type": "string", "minLength": 1, "description": "Two laps compare only when track_id matches." },
    "session_id": { "type": "string" },
    "driver": { "type": "string", "pattern": "^[A-Z]{3}$" },
    "lap_no": { "type": "integer", "minimum": 0 },
    "duration_ms": { "type": "integer", "minimum": 1 },
    "sector_ms": {
      "oneOf": [
        { "type": "array", "items": { "type": "integer", "minimum": 1 }, "minItems": 3, "maxItems": 3 },
        { "type": "null" }
      ]
    },
    "valid": { "type": "boolean" },
    "meta": { "type": "object", "description": "Producer-specific fields, for example provenance or Photoncar line_id." },
    "samples": {
      "type": "object",
      "additionalProperties": false,
      "required": ["t_ms", "dist_m", "speed_kph", "throttle_pct", "brake", "gear", "rpm", "x", "y"],
      "properties": {
        "t_ms":         { "type": "array", "minItems": 2, "items": { "type": "integer", "minimum": 0 } },
        "dist_m":       { "type": "array", "minItems": 2, "items": { "type": "number", "minimum": 0 } },
        "speed_kph":    { "type": "array", "minItems": 2, "items": { "type": "number", "minimum": 0 } },
        "throttle_pct": { "type": "array", "minItems": 2, "items": { "type": ["number", "null"], "minimum": 0, "maximum": 100 } },
        "brake":        { "type": "array", "minItems": 2, "items": { "type": ["boolean", "null"] } },
        "gear":         { "type": "array", "minItems": 2, "items": { "type": ["integer", "null"], "minimum": 0, "maximum": 10 } },
        "rpm":          { "type": "array", "minItems": 2, "items": { "type": ["number", "null"], "minimum": 0 } },
        "x":            { "type": "array", "minItems": 2, "items": { "type": "number" } },
        "y":            { "type": "array", "minItems": 2, "items": { "type": "number" } }
      }
    }
  }
}
```

Export rules for FastF1 laps (FACT from the probe unless marked):

- Car rows only, plus 2 edge rows at t = 0 and t = lap time. XY interpolated at car timestamps (costs 0.7 to 2 ms median delta accuracy, halves the size). One Hungary lap: 297 car rows, 13,935 B raw, 5,144 B gzip.
- Precision: `t_ms` integer; `dist_m` 2 dp; `speed_kph` as delivered (integers); `throttle_pct` integer; `brake` boolean (raw 0/100/104 cast to bool); `gear` integer; `rpm` integer; `x`, `y` meters at 1 dp (raw F1 unit is 0.1 m).
- Drop X=Y=Z=0 padding rows. The raw sentinels (throttle 104, brake true while parked, gear 0 in the pits) appeared only outside timed laps in the probe, so the exporter asserts throttle <= 100 inside every exported lap instead of clamping silently.
- Lap QA: reject laps whose distance is not within a few percent of the reference, flag telemetry gaps over 1 s (6 of 97 Hungary laps had a 1511 ms gap).
- 2026 laps have no DRS channel (FastF1 fills 0). The schema carries no DRS field.
- Per session, the exporter also writes `track.json` (reference path, corner labels with our computed positions, sector line positions) and a manifest entry. These are internal files, typed in TypeScript, not part of the published lap schema.

Validation: `pnpm validate:laps` runs ajv (Ajv2020) over every lap in `public/data/` and `fixtures/`, plus the equal-length and monotonic checks. This is acceptance criterion 4.

## 3. Corner detection and the analysis method

Measured on 2026 Hungary Q (96 accurate laps), with the fallback detector held out on 2026 Monza Q. All of it is pure code: TypeScript in the browser (5.8 to 6.2 ms per lap pair in Node 22), mirrored 1:1 by a stdlib-only Python reference.

**Alignment.** Common axis s in [0, L], L = the session reference lap's integrated distance. Each lap is shifted to start at 0, scaled to L, then warped by XY projection onto the reference path (offsets smoothed over +-300 m, knots every 100 m, pinned at 0 and L). Why: integrated distance drifts 25.5 m median against position over a lap, and raw XY carries about 3.5 m noise per sample.

**Time delta.** delta(s) = tB(s) - tA(s). When both laps have sector times, a linear ramp anchors delta to the official splits (sector lines = per-session median positions: Hungary 1724.31 m and 3245.29 m). Error at a sector line after leave-one-out anchoring: 14.1 to 21.0 ms median, 53.0 to 78.9 ms p95. FastF1's `utils.delta_time` is deprecated and measured 55 ms wrong with the wrong sign at the S1 line on the probe pair, so it is not used.

**Corners, primary.** Project each FastF1 circuit-info marker onto the reference path once per session. Error across 96 laps: median 2.03 m, p95 7.09 m. Markers under 100 m apart merge into one row (Hungary T6-7). `get_circuit_info()` crashes when MultiViewer has no circuit (Madrid 2026), so the exporter wraps it and falls back.

**Corners, fallback.** Speed minima on the reference lap: 20 m moving average, prominence >= 10 km/h, >= 100 m spacing. Finds about 71% of corner groups (Hungary 1021 of 1440, Monza 124 of 176), 0 extras on reference laps, mean position error 13.4 to 19.9 m. Misses flat kinks and merges chicanes by design. Detected corners are labeled C1..Cn, never official turn numbers.

**Corner table**, per corner and driver:

- Braking point: start of the last brake-on run before the corner's minimum-speed sample, in integer m before the corner marker, with the sample gap shown as resolution. Brake is boolean at about 4 Hz, so at >= 300 km/h samples are 22 to 25 m apart median (dropouts up to 95 m). A braking difference is reported only when it exceeds both sample gaps. On the probe pair, none did.
- Minimum speed: lowest raw sample in the segment. Flagged "edge" (not quoted) when it sits on a segment boundary, which marks a flat corner.
- Exit speed: speed at the last marker + 75 m. At +75 m, 110 of 110 lap-corners were past their minimum and 75 of 110 still before full throttle. Flagged "clamped" (not quoted) when it hits the segment end.
- Time gained or lost: segments split at midpoints between corners. Integer ms from rounding the cumulative delta at each boundary, then subtracting, so rows sum exactly to the lap gap (conservation error 0 ms on the sample and on 32 sweep pairs).

**Mini-sectors.** 25 equal-distance slices of [0, L]. Faster driver = smaller elapsed time inside. Probe pair: NOR 14, HAM 11. Slices under 25 ms get a lighter tint (split-half noise p95 is 24.2 ms).

**Top 3 gains and losses.** Corner rows with |delta| >= 30 ms, A's view, sorted by magnitude, earlier corner wins ties. Fewer than 3 is allowed and stated; never padded. 30 ms sits above the measured noise p95 (25.3 ms). Supporting facts (braking, min speed, exit speed) attach only when they pass their own checks, and code picks the cause tag, not the model.

**Precision.** Every number that can reach the UI or a note is formatted once, by code, from integers: time as a magnitude in seconds to 3 dp plus a direction word ("gains 0.103 s"), speeds in integer km/h, braking in integer m. One `roundHalfAway` in both languages (JS `Math.round(12.5)` is 13, Python `round(12.5)` is 12), never `-0`.

**Parity test (acceptance criterion 2).** `fixtures/synthetic/` holds a generated track and 2 laps with planted differences (for example B brakes 20 m later at one corner, carries 6 km/h less at another). Python writes `expected.json`; vitest runs the TS analysis on the same files and requires exact equality for integers, labels, flags, ordering and display strings, and 1e-9 for floats. A second assertion checks that the planted differences are found where they were planted. The prototypes were already bit-identical on 73,924 of 73,924 floats across 32 real pairs. The same test runs locally on a real pair when `public/data/` exists; CI skips it. Constants (grid step, windows, 75 m exit, 30 ms floor, 25 slices) live in one `analysis-config.json` read by both sides.

### 3b. Contracts fixed after the critic pass

The critic re-ran the model agent's validator and read all 7 outputs side by side. These contracts close the gaps it found:

1. **One formatter contract** (in `analysis-config.json`, used by the table, readout, tooltips and notes): time is an unsigned magnitude plus a code-chosen direction word ("gains 0.103 s", "loses 0.084 s"). The model view carries no signed deltas. Signs appear only on the chart axis.
2. **One corner-label grammar**: `[TC]\d{1,2}[A-Z]?(?:-\d{1,2}[A-Z]?)?` (T4, T12A, T6-7, C3). The validator matches labels before it tokenizes numbers. FACT from the critic's run: without this, the grouped label "T6-7" fails its own template note with `number not in insight: "-7"`. Tests cover a group, a letter suffix and a C-label, and one test asserts every template note passes.
3. **Deterministic cause rule**: the supporting fact for a finding is chosen by code from candidates that pass their checks, in fixed priority: braking (only when the difference beats both sample gaps), then minimum speed (not "edge", difference above 3 km/h [P]), then exit speed (not "clamped", difference above 3 km/h [P]). If none passes, the cause is `time_only` ("T12A, you lose 0.084 s."). On the probe pair, 4 of 6 findings (T4, T1, T12A, T12) are `time_only`. (Corrected in Phase 2: the first draft said 2 of 6. The analysis and exporter engineers each confirmed 4 of 6 under this rule, because the T4 and T1 speed differences are 3 km/h or less.)
4. **Direction check is mandatory**: a gain note may not contain lose, lost or slower; a loss note may not contain gain, gained or faster.
5. **Note length**: 110 characters maximum [P], to fit the 2-line layout.
6. **No model call on page load**: default views show template or pre-generated notes. A model call happens only on an explicit "Write notes" action. This keeps brief rule "no live API calls on page load" intact.
7. **Cursor store** holds `{ mode: "distance", i }` or `{ mode: "time", tMs }`. Hover and corner links use distance; the ghost replay uses time, because at one moment the two cars sit at different distances. Keyboard path: the native range input (time), one focusable chart group whose arrow keys step the distance cursor (10 m, Shift 100 m, Home and End), corner rows and note links. Each chart stays `role="img"` inside that group; the map is `role="img"` and is not focusable. (Changed in Phase 2 review: the first draft left the charts unfocusable, which contradicted the keyboard crosshair in section 4, and a keyboard user could not move the distance readout.)
8. **Reference lap QA**: the reference is the fastest QA-passed lap whose distance is within 2% [P] of the session median (Hungary spread was 1.7%). This skips anomalies like the 2026 Monza pole lap (111.1 m longer than P2).
9. **Exporter QA** [P]: reject a lap with 0 m distance, distance outside 2% of the session median, missing XY, or throttle above 100; flag (keep, mark low confidence) a lap with a telemetry gap over 1500 ms or an anchoring correction over 100 ms. (Changed in Phase 2 from 1000 ms: across the 763 exported laps, the median lap's largest car-data gap is 1120 ms and the p95 is 1440 ms, so 1000 ms flagged 71.8% of laps, pole laps included. At 1500 ms it flags 30 laps, 3.9%.) Validate every lap against the schema on write and fail loudly. The manifest lists only QA-passed laps, and the "any lap" picker reads it.
10. **Synthetic fixture scope**: 1 track and 3 laps (A and B with sector times, C with none, like a Photoncar lap), covering a chicane group, a flat kink with an edge minimum, a clamped exit, a brake dropout and planted gains and losses. CI runs both the TS and the Python side.
11. **Track file**: `track-schema.json` (reference path, corner labels with positions, sector lines) sits beside the lap schema. Analysis runs on laps alone (reference path from lap A, fallback detector); the track file only adds official corner labels and sector anchoring.
12. **Tie color**: a mini-sector with a 0 ms difference is drawn in Graphite.

Honest limits: corner deltas inside sectors are estimates (only 3 official timing lines exist); unanchored laps (Photoncar, imports) are good to about 28 ms median; attribution depends on the boundary rule (a max-speed rule moves Hungary T4 from +103 to +38 ms); validated deeply on one session only.

## 4. Chart library: uPlot 1.6.32

Benchmarked 7 options at 5 charts x 2 series x 3,000 points, including a real Next 16.3.6 build (FACT):

| Library | gzip | Built-in cross-chart sync | Hover p95 at 4x CPU throttle | Verdict |
|---|---|---|---|---|
| **uPlot 1.6.32** (MIT, canvas) | 23,030 B | Yes (`cursor.sync.key`) | 9.2 ms | **Pick** |
| visx 4.0.0 primitives (MIT, SVG) | 26,167 B | No (store wires it) | 9.2 ms | Runner-up |
| No library (canvas) | 0 B | Ours | 9.2 ms | Fallback |
| Chart.js 4.5.1 | 54,669 B | No | 9.2 ms | No |
| Observable Plot 0.6.17 | 87,455 B | No | 9.2 ms | No |
| Recharts 3.10.1 | 112,010 B | Yes (`syncId`) | 33.8 to 36.4 ms | No: slowest |
| ECharts 6.1.0 | 170,635 B | Yes (`connect`) | 17.4 to 24.6 ms | No: heaviest |

Net benefit over no library: 23,030 B buys axes, ticks, HiDPI scaling, resize and cross-chart sync that we would otherwise write and test ourselves, at no frame cost.

Wiring: one dependency-free cursor store (`useSyncExternalStore`) holds a single index into the shared 2 m distance grid. uPlot's sync keeps the 5 charts together; the same store drives the SVG track map markers, the scrub bar (a native range input, which is also the keyboard path), corner-row clicks and an `aria-live` readout. Probe: 5 of 5 charts synced on hover, on store-driven scrub and on keyboard, with 0 console warnings in dev and prod.

Risks: single maintainer, no npm release since 2025-03-14 (commits through 2026-09-22). Canvas has no built-in a11y, so each chart gets `role="img"` and an `aria-label`, the five share one focusable group with arrow-key crosshair control (section 3b item 7), and the corner table is their text alternative. If uPlot blocks us, the store design makes the swap to visx local to one component.

## 5. Visual system: "Plot sheet"

An engineer's printed overlay sheet: cool paper, graphite hairlines, black ink for every word and control. Only two colored inks, one per lap, so any color on screen means a driver. One shared distance ruler with corner labels as ticks. Designed with the impeccable and dataviz skills.

| Name | Hex | Role |
|---|---|---|
| Paper | `#F8F9FB` | The only surface: page and chart background |
| Ink | `#13171E` | Text, headings, delta trace, crosshair, focus ring, primary button |
| Graphite | `#565B63` | Secondary text, ticks, units, disclaimer, control borders |
| Rule | `#D7D9DD` | Hairlines, gridlines, scrub track, skeleton blocks (decorative only) |
| Driver A violet | `#5D2BA6` | Lap A marks only: traces, mini-sectors, circle marker |
| Driver B bronze | `#A36E09` | Lap B marks only: traces, mini-sectors, diamond marker |

Contrast (computed twice, by the design agent and again independently): Ink on Paper 17.05:1, Graphite on Paper 6.49:1, Graphite on Rule 4.84:1 (all AA). Driver A on Paper 8.44:1, Driver B on Paper 4.16:1 (both above the 3:1 non-text bar). No text ever sits on a driver color (Ink on bronze is 4.10:1, a fail, so it is banned). CVD: dataviz validator exit 0; worst pair dE 29.7 (protan), tritan 20.4, target 8. A and B also differ by marker shape and 3-letter labels, because their luminance ratio is only 2.03:1. Avoided: every 2025 and 2026 team color from OpenF1 and FastF1 (29 values, listed in the research output).

Type: **Atkinson Hyperlegible Next** (400, 500, 700) for every word, and **Atkinson Hyperlegible Mono** (400, 500) for computed values only, including each number inside a note. Both load through `next/font/google` (no package). Next keeps 0/O and 1/l/I apart, which matters for T1 vs T11. Mono has tabular digits at the same 632-unit advance as Next, so inline numbers do not shift the baseline.

| Token | Desktop px | Phone px | Line height | Weight | Use |
|---|---|---|---|---|---|
| page-title | 24 | 20 | 1.2 | 700 | Session heading |
| panel-title | 16 | 16 | 1.3 | 700 | Panel headings |
| body | 16 | 16 | 1.5 | 400 | Note prose, empty and error copy, max 70ch |
| control | 14 | 16 | 1.4 | 500 | Selects, buttons, table headers |
| meta | 13 | 13 | 1.4 | 400 | Disclaimer, units, legend |
| tick | 12 | 12 | 1.2 | 400 | Axis ticks, corner labels |
| readout | 20 | 18 | 1.2 | 500 mono | Live readout, lap times, gap |
| data | 14 | 14 | 1.4 | 400 mono | Corner table values |

Rules: 4 px spacing base. Panels are separated by 1 px Rule hairlines, with no cards, fills or shadows. Radius 2 px on controls, 0 elsewhere. Focus: 2 px Ink outline, 2 px offset, on every control and on the chart group. The map is an image, not a control. Focus never lands under the sticky readout (`scroll-padding-top` follows its height). Motion: only the ghost replay and hover markers move; no fades, no smooth scroll; reduced motion stops autoplay (Play still works). The disclaimer sits in the app bar on every route, so it is in every first viewport, including `global-error.tsx`, which must render it itself. Phone: one column at 390 px with no "Best on desktop" fallback, because the brief grants none; the phone order is map with scrub, then notes, charts, corner table. From 1024 px the page is two columns and the sections are rendered charts, map, notes, table, so the source order (and Tab) matches what the eye reads at every width.

Open point: the design is light only. A dark theme is not required by the brief and is not planned.

## 6. Model route (notes)

- Model `claude-haiku-4-5-20251001` (alias `claude-haiku-4-5`), confirmed current in the Anthropic models overview. Price $1 per MTok input, $5 per MTok output.
- JSON via structured outputs (`output_config.format`, GA, Haiku 4.5 supported). temperature 0, max_tokens 800, no thinking.
- The server rebuilds the insight from static files using pair ids checked against the manifest. It never accepts insight JSON from the browser.
- Validator: every number token in a note must exactly match a display string of that note's own finding (stricter than the brief's insight-wide rule). Corner labels must match the finding. Leftover digits or number words fail the note. Copy rules (no em or en dashes, banned words, 140 chars) are enforced too. On failure: 1 retry with the errors, then a deterministic template note built only from display strings.
- Cache key: sha256 of canonical insight JSON + model id + prompt version. Layers: committed-to-bundle records, in-memory LRU, CDN on the GET route.
- Limits: per-IP 5 generations per 10 min per instance [P]; daily spend ledger `NOTES_DAILY_SPEND_CAP_USD` = 0.50 per instance [P]; `NOTES_ENABLED` kill switch; at deploy, one Vercel WAF rule (30 req per 60 s per IP [P]); the hard ceiling is a dedicated Anthropic workspace with a monthly spend limit ($5 [P]), which Nate creates. Honest limit: without a shared store, daily spend can reach instances x cap.
- Spend estimate (ESTIMATE, token counts not yet measured): worst case $0.0065 per call, $0.0130 per insight with retry; typical $0.00325.
- `.env.example`: `ANTHROPIC_API_KEY=`, `NOTES_ENABLED=`, `NOTES_DAILY_SPEND_CAP_USD=`. Server-only module; never a `NEXT_PUBLIC_` name. Pass `apiKey` explicitly, because the SDK otherwise falls back to other credential sources.
- Phase 2 builds and tests the route against a mocked client. A live call needs a key Nate puts in `.env.local` himself.

## 7. File tree

```
race-engineer/
├── README.md                     # order per brief section "Publish", item 8
├── LICENSE                       # MIT (Phase 5)
├── CLAUDE.md                     # repo conventions for agents
├── lap-schema.json               # the shared lap schema (published in README)
├── track-schema.json             # optional per-track context: reference path, corner labels, sector lines
├── analysis-config.json          # constants read by TS and Python
├── .env.example                  # names only
├── .gitignore                    # public/data/, .cache/, .env*, test output
├── .github/workflows/ci.yml      # install, lint, format check, typecheck, tests (TS + Python stdlib), build
├── package.json  pnpm-lock.yaml  tsconfig.json (strict)  next.config.ts
├── eslint.config.mjs  .prettierrc  postcss.config.mjs
├── app/
│   ├── layout.tsx                # fonts, app bar with the disclaimer line
│   ├── page.tsx                  # session picker and compare view
│   ├── loading.tsx  error.tsx  not-found.tsx  global-error.tsx
│   ├── about/page.tsx            # method, data sources and terms, full F1 disclaimer, limits
│   ├── globals.css               # Tailwind v4 @theme tokens
│   └── api/notes/route.ts        # server-only model route
├── components/
│   ├── session-picker.tsx  lap-picker.tsx
│   ├── telemetry-charts.tsx      # 5 synced uPlot charts
│   ├── track-map.tsx             # SVG, 25 mini-sectors, ghost markers
│   ├── scrub-bar.tsx  ghost-replay.tsx  cursor-readout.tsx
│   ├── corner-table.tsx
│   └── engineer-notes.tsx
├── lib/
│   ├── analysis/                 # align, delta, corners, detect, minisectors, findings, format (+ tests)
│   ├── notes/                    # server only: insight, prompt, client, validate, template, cache, limits (+ tests)
│   ├── cursor-store.ts
│   └── data.ts                   # static manifest and lap loaders
├── pipeline/                     # Python
│   ├── requirements.txt          # fastf1==3.8.3 (export only)
│   ├── sessions.json             # the N chosen sessions, by round number
│   ├── export_sessions.py        # FastF1 to public/data/ in the lap schema
│   ├── synthetic.py              # stdlib only: writes fixtures/synthetic/
│   ├── reference/analysis.py     # stdlib-only recomputation
│   └── tests/test_reference.py   # unittest (stdlib)
├── fixtures/synthetic/           # committed: track.json, lap-a.json, lap-b.json, lap-c.json (no sectors), expected.json, notes.json
├── public/data/                  # gitignored: exported sessions, served at /data/
├── scripts/
│   ├── validate-laps.ts          # acceptance 4
│   ├── check-notes.ts            # acceptance 3
│   ├── notes-pregen.ts           # spends money, runs only with Nate's OK
│   ├── copy-lint.ts              # dashes and banned words in UI strings, README, portfolio
│   └── portfolio-capture.ts      # Playwright (Phase 4)
├── docs/phase-1-plan.md
├── tasks/todo.md  tasks/lessons.md
└── portfolio/                    # Phase 4
```

Why `public/data/`: the brief says "/data", and this serves the files at the URL path `/data/` with no build copy step. Next.js sits at the repo root so Vercel needs no root-directory setting.

## 8. Sessions (D2)

Swept 62 qualifying sessions (2024 R1 to 2026 R14): 62 loaded, 0 errors. Every gap below is exact from the data.

The session table with real lap times is kept out of the public repo. Picks: 2026 Hungary Q, 2025 Japan Q, 2025 Saudi Arabia Q, 2026 Spain (Madrid) Q.

Size (all timed laps, per session): 5.33 to 8.46 MB raw, 1.93 to 3.06 MB gzip; cold export 25.7 to 35.9 s. Races are about 43.76 MB raw each, so they wait for the stretch race view. INFERENCE: the brief's "race session" means a session of a race weekend; qualifying is where fastest-lap comparison is cleanest.

Excluded, with reasons from the data: wet sessions (2024 Silverstone, Spa, Brazil; 2025 Las Vegas); sessions where the fastest laps disagree with the official order (2025 Hungary, 2024 Canada, 2024 Bahrain, 2024 Singapore, 2025 Baku); 2026 Monza (integrated distance differs by 111.1 m between the top 2 laps).

## 9. Toolchain versions (verified on npm and PyPI, 2026-09-23)

next 16.3.6, react and react-dom 19.3.0, tailwindcss 4.3.3 (CSS-first `@theme`, no config file), typescript **5.9.3** (pinned: 7.0.2 breaks typescript-eslint), eslint **9.39.5** (pinned: 10.x breaks eslint-config-next plugins), eslint-config-next 16.3.6, prettier 3.9.9, vitest 5.0.1 with vite 8.3.0, @playwright/test 1.63.0, ajv 8.20.0, uplot 1.6.32, @anthropic-ai/sdk 0.128.0, fastf1 3.8.3 on Python 3.14.6.

Setup traps: `next dev` writes its own AGENTS.md and CLAUDE.md when it detects an agent, so set `agentRules: false` in `next.config.ts`. Playwright wants Chromium revision 1243, not in the local cache; install it with `PLAYWRIGHT_BROWSERS_PATH=0` so it lands in `node_modules`, not `~/Library`.

## 10. Dependencies needing approval (D3)

| Package | Why | Net benefit | Alternative |
|---|---|---|---|
| uplot 1.6.32 | Charts | Section 4 | visx or hand-rolled canvas |
| vitest 5.0.1 + vite 8.3.0 (dev) | TS tests | Standard runner, fast, TS native | `node:test` (more setup) |
| ajv 8.20.0 (dev) | Schema validation | Real 2020-12 validator for acceptance 4 | Hand-written checks |
| @anthropic-ai/sdk 0.128.0 | Model route | Typed errors for the failure policy, retries, structured output parsing, refuses to bundle into the browser | Plain fetch, about 60 to 80 lines |

Not needed: jsonschema or pytest in Python (the reference is stdlib only), Upstash (only if traffic proves the per-instance limits too loose; it is a paid service).

## 11. Verification and contradictions resolved

- Terms quotes: an adversarial verifier re-fetched every page. 6 of 7 claims confirmed verbatim, 1 partly (OpenF1's license wording). It found 3 more restrictions (section 1).
- Critic pass over all 7 research outputs: it re-derived the spend table, session sizes, corner and mini-sector sums, contrast ratios and tint hexes, and all matched. It found 5 high and 10 medium issues. The high ones are resolved in sections 1, 3b and here. It flagged one unsourced number in the first draft (a build-time range from the terms agent), now replaced by the sessions agent's measured export times.
- Font check (FACT, critic): Next 16.3.6 `font-data.json` lists both "Atkinson Hyperlegible Next" and "Atkinson Hyperlegible Mono".
- Model lifecycle: the Anthropic deprecations page lists `claude-haiku-4-5-20251001` as retiring "not sooner than October 15, 2026". Recheck at Phases 5 and 6. The cache key already includes the model id, and any larger model needs Nate's OK.
- Design risk (low): on F1 timing screens, purple means fastest and yellow means slower. Violet for A and bronze for B can read that way on the mini-sector map. The map carries the legend "Color shows who was faster in each mini-sector" and driver codes on every mark.
- Disclaimer: the verifier notes the brief's short line uses "Formula 1" as a noun, which the Guidelines advise against, and suggests "Unofficial. Not associated with the Formula 1 companies." Hard rule 2 fixes the text, so the plan keeps the brief's line and adds F1's full disclaimer to the home page footer. Nate can change the short line.
- Contrast ratios: recomputed independently; all match to 2 dp.
- Contradiction: the corner agent proposed a real F1 lap pair as the committed parity fixture; the terms agent says commit 0 F1 files. Resolution: synthetic fixture in git, real-pair parity locally.
- Contradiction: the model agent formatted deltas with signs ("-0.071 s"); the corner agent uses magnitudes with direction words. Resolution: magnitudes plus direction words. Signs appear only on chart axes.
- Contradiction: the model agent proposed committed notes for curated F1 pairs; under D4 those carry F1-derived numbers. Resolution: F1 notes live under `public/data/notes/` (gitignored); committed notes are synthetic only.

## 12. Phase 2 build order (after approval)

1. Scaffold (Next 16, strict TS, Tailwind v4 tokens from section 5, ESLint, Prettier, vitest), repo CLAUDE.md, `.gitignore`, CI skeleton.
2. `lap-schema.json` + `pipeline/synthetic.py` + `validate-laps.ts`.
3. Python reference analysis + unittest; TS analysis mirrored 1:1; parity test on the synthetic pair (acceptance 2).
4. `export_sessions.py` for the N sessions; validate every lap (acceptance 4); local real-pair parity.
5. UI: picker, synced charts, track map with mini-sectors, ghost replay, corner table, loading, empty and error states.
6. Notes: insight builder, template notes, validator, `check-notes.ts` (acceptance 3), model route with limits and cache, mocked tests; Claude on the synthetic pair per D1.
7. Report: test count and pass rate, build output, open issues.
