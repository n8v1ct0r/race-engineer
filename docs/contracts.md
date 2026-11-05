# Contracts

The interfaces every part of the build agrees on. `docs/phase-1-plan.md` explains why; this file says what. If code and this file disagree, fix one of them in the same change.

## 1. Files and where they live

| Path | In git | What |
|---|---|---|
| `lap-schema.json` | yes | The shared lap schema (race-engineer.lap/v1). Photoncar field names. |
| `track-schema.json` | yes | Optional per-session track context (race-engineer.track/v1). |
| `analysis-config.json` | yes | Every analysis constant. Read by TypeScript and Python. Never hard-code these. |
| `public/demo/` | yes | The synthetic session, served at `/demo/`. Made by `pipeline/synthetic.py`. |
| `public/data/` | **no** | Exported F1 sessions, served at `/data/`. Made by `pipeline/export_sessions.py`. |
| `fixtures/parity/` | yes | Python reference output for the synthetic pairs (`expected.json`) and the differences planted in the synthetic laps (`planted.json`). Both made by `pipeline/synthetic.py`. |
| `fixtures/notes/` | yes | Note records for every ordered synthetic demo pair: `*.fake.json` from `FakeNotesClient` (labelled fake) and `*.template.json`. Made by `node scripts/check-notes.ts --write-fixtures`; synthetic only. |
| `.cache/` | **no** | FastF1 cache and dev notes cache. |

Both `public/demo/` and `public/data/` hold the same layout:

```
manifest.json
<session_id>/track.json
<session_id>/laps/<lap_id>.json
```

Every lap file meets `lap-schema.json` plus rules JSON Schema cannot state, all checked by `scripts/validate-laps.ts`: the sample arrays have equal length, `t_ms` strictly increases, `t_ms` spans exactly `duration_ms` (last minus first), and when `sector_ms` is present its 3 values sum to `duration_ms`. The lap gap comes from `t_ms` and the lap times from `duration_ms`, so these two rules keep them from disagreeing (section 4).

## 2. IDs

- `session_id`: `<season>-<round, 2 digits>-<session code lowercase>`, for example `2026-11-q`. The synthetic session is `synthetic-demo`.
- `lap_id`: `<DRIVER>-<lap_no>`, for example `NOR-15`. Synthetic drivers are `AAA`, `BBB`, `CCC`.
- `track_id`: a lowercase slug of the circuit, for example `hungaroring`. Laps compare only when `track_id` matches.
- URL slug for an F1 session: `/f1/<season>/<location slug>/<session code lowercase>`, for example `/f1/2026/budapest/q`. Location slug = FastF1 `Location`, lowercased, spaces to hyphens, accents stripped. The synthetic session lives at `/demo`.
- Pair selection in the URL query: `?a=NOR-15&b=HAM-11`. Missing means the session's `default_pair`.

## 3. Manifest (`manifest.json`)

```json
{
  "schema": "race-engineer.manifest/v1",
  "sessions": [
    {
      "session_id": "2026-11-q",
      "origin": "fastf1",
      "season": 2026,
      "round": 11,
      "event_name": "Hungarian Grand Prix",
      "location": "Budapest",
      "location_slug": "budapest",
      "session_code": "Q",
      "session_name": "Qualifying",
      "date": "2026-07-25",
      "track_id": "hungaroring",
      "corner_source": "official",
      "default_pair": { "a": "NOR-15", "b": "HAM-11" },
      "drivers": [
        {
          "code": "NOR",
          "laps": [
            {
              "lap_id": "NOR-15",
              "lap_no": 15,
              "duration_ms": 85275,
              "sector_ms": [26940, 30000, 28335],
              "segment": "Q3",
              "compound": "SOFT",
              "tyre_life": 3,
              "personal_best": true,
              "deleted": false,
              "deleted_reason": null,
              "yellow": false,
              "qa": "ok",
              "qa_notes": []
            }
          ]
        }
      ],
      "provenance": {
        "fastf1": "3.8.3",
        "exported_at": "2026-09-23",
        "livetiming_mirror_used": false,
        "jolpica_fields": ["results"],
        "hosts": ["livetiming.formula1.com", "api.multiviewer.app", "api.jolpi.ca"]
      }
    }
  ]
}
```

The timing values in this example are made up (the synthetic lap AAA-1), not exported data. Rules: `event_name` is FastF1's short `EventName`, never `OfficialEventName` (it carries sponsor names). The manifest lists only laps that passed exporter QA; `qa` is `ok` or `low_confidence`. `corner_source` is `official` or `detected`. No team names, no driver full names, no images. `segment`, `compound`, `tyre_life`, `yellow` may be null for synthetic laps. `season`, `round` and `date` are null for the synthetic session.

F1 sessions (`pipeline/export_sessions.py`): `date` is the local session date. `track_id` is the slug of FastF1's circuit short name (`hungaroring`, `madring`). `default_pair` is the personal-best laps of the two fastest drivers (deleted laps excluded). `yellow` is true when the lap's FastF1 `TrackStatus` contains `2`. `deleted` is null only if FastF1 has no race control messages. `qa_notes` are short sentence-case strings (`Telemetry gap of 1250 ms`, `Sector anchor correction of 134 ms`, `Throttle unknown at 2 samples`).

QA of samples (`pipeline/lap_qa.py`, used by both producers): a raw throttle outside 0 to 100 is not a throttle position (FastF1 sends the sentinel 104), so the exporter writes it as null and keeps the lap. It never clamps it to 100. Any lap with a null throttle, brake or gear sample, whatever the cause, is `low_confidence` with one note per channel: `Throttle unknown at 2 samples`, `Brake unknown at 1 sample`, `Gear unknown at 1 sample`. A null rpm sample does not flag a lap, because rpm is neither shown nor analyzed. The synthetic lap CCC-1 carries 2 null throttle samples, 1 null brake sample and 1 null gear sample (Photoncar-like dropouts), so its manifest entry is `low_confidence` and parity covers null channels. `provenance.hosts` lists the hosts whose data reached the files: the livetiming host (plus `livetiming-mirror.fastf1.dev` when FastF1 fell back to it), `api.multiviewer.app` only when official corners were found, `api.jolpi.ca` when FastF1 merged Jolpica results into its driver list (`jolpica_fields: ["results"]`; the export reads only driver codes from that list).

## 4. Analysis (`lib/analysis/`, mirrored by `pipeline/reference/analysis.py`)

One entry point: `analyzePair(lapA, lapB, track | null, config) -> Comparison`. Pure, deterministic, no I/O. The Python reference exposes `analyze_pair(lap_a, lap_b, track, config) -> dict` with the same field names in snake_case JSON. Parity is checked on JSON output.

Direction: every time value is from **driver A's view**. A corner delta above 0 means A gained. Display strings never carry a sign; they carry a direction word.

`Comparison` carries at least: the reference length `L_m`; the 2 m grid (`s_m`, and per driver `t_ms`, `speed_kph`, `throttle_pct`, `brake`, `gear`, `x`, `y`) plus `delta_ms` on the grid; whether delta is anchored to sector splits; corner rows; 25 mini-sectors; findings (up to 3 gains, up to 3 losses); the lap gap. Exact TypeScript types live in `lib/analysis/types.ts` (owned by the analysis module).

Corner labels follow one grammar: `^[TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)?$`. `T` = official marker(s), `C` = detected. Markers closer than `corners.group_m` merge into one row: `T6-7`.

Cause of a finding, chosen by code in this priority, each only if it passes its check: `braking` (both laps have a braking point in the segment, neither brake run starts on the segment's first sample, and the integer difference beats both integer sample gaps), `min_speed` (neither minimum at a segment edge, integer difference above `findings.level_speed_kph`), `exit_speed` (not clamped, integer difference above `findings.level_speed_kph`). Otherwise `time_only`. A finding's `display` object holds only the strings whose check passed. Findings list gains first, then losses, each by magnitude; ids are `gain-1` to `gain-3` and `loss-1` to `loss-3`.

Anchoring: delta is anchored only when both laps have `sector_ms` and the track has `sector_lines_m`; otherwise neither lap is anchored (`anchored: false`). The UI names the reason: no track file, no sector lines, or a lap without sector times. The anchor ramp returns to 0 at `L`, so the lap gap is the difference of the two `t_ms` spans; it equals `duration_ms` B minus A because of the section 1 lap rules.

Null samples (throttle, brake, gear, rpm; `t_ms`, `dist_m`, speed and XY are never null): both twins leave a gap and never invent a value. Throttle on the grid is linear between the 2 bracketing samples and null when either of them is null (`interpNullable` / `interp_nullable`), so one null sample blanks the grid between the sample before it and the sample after it (grid points on those 2 samples keep their values). Brake and gear take the previous sample's value (`stepPrev` / `step_prev`), so a null sample reads null from itself up to the next sample. A braking point counts only `true` brake samples: a null sample is not braking and ends a brake run. rpm is not used. The charts draw a null grid point as a gap (uPlot's default, `spanGaps` off) and the cursor readout shows `no data`.

Lap meta (`lap_a`, `lap_b`) carries `top_speed_kph`, the highest raw speed sample rounded half away (not the 2 m grid maximum, which interpolation can lower), and its display string `display.top_speed`.

## 5. Display strings (`lib/analysis/format.ts`, mirrored in Python)

Every number that can reach the UI or a note is formatted once, by code, from integers.

- Time delta: magnitude in seconds to 3 dp via integer math, plus a direction word: `gains 0.103 s`, `loses 0.084 s`, `level`. Never a minus sign, never `-0`.
- Lap time: `m:ss.sss` from integer ms (`1:25.371`).
- Speed: integer km/h (`234 km/h`). Distance: integer m (`54 m`). Percent: integer with `%` (`85%`, throttle in the readout).
- Braking point: integer m before the row's first marker plus a word (`54 m before`, `12 m after`).
- Comparison words, from A's view: `later` or `earlier` for braking, `higher` or `lower` for speeds. Differences are computed from the displayed integers.
- Rounding: one `roundHalfAway` in both languages. Never `toFixed`, `Math.round`, Python `round()` or f-string rounding on a value that reaches the UI or a note.
- Charts may draw raw floats; any tooltip that shows a number also used in a note renders the same display string.

## 6. Notes

- `lib/notes/` builds the insight (model view) from a `Comparison`, the template notes, the validator, the cache, the limits, and the Claude client. Server-only modules (`client`, `cache`, `limits`, `generate`, `handler`) import `lib/notes/server-only.ts` first, which throws when a browser loads them, and never use `NEXT_PUBLIC_`. Browser-safe modules: `template.ts` (the UI imports `templateNotes(c)` and the `Note`, `NotesResponse` types from it), `insight.ts`, `validate.ts`, `prompt.ts`, `copy-rules.ts`.
- **Claude writes notes only for laps with origin `synthetic` or `photoncar`.** For `fastf1` laps the UI shows template notes built by code, and the route refuses the request. This is Nate's decision D1 and it is enforced in code and in a test.
- Insight (`buildInsight(c)`, schema `race-engineer.insight/v1`): `{ origins: {a, b}, perspective: "A", driver_a: {code, lap_time}, driver_b: {code, lap_time}, lap_gap: {direction, time}, findings: [{ id, kind, corner, cause, display }] }`. Every value is a string; no raw floats, no signed deltas. A finding's `display` holds `direction`, `time` and the passing fields of section 4 (`brake_a`, `brake_b`, `brake_diff`, `brake_word`, `min_speed_*`, `exit_speed_*`); the braking sample gaps stay out.
- Validator (`checkNote`, `numcheck-v3`): corner labels are matched before number tokens; every number token must equal a display string of the note's own finding or `lap_time` / `lap_gap.time`; a note that cites a lap time or `lap_gap.time` must also cite its own finding's `time`, so a lap-level number never stands in for the corner's; the note carries its own corner label and no other; a gain note never says lose, lost or slower and a loss note never says gain, gained or faster; no number words, stray digits, dashes, banned words, markdown or emoji; at most `analysis-config.json` `notes.max_chars` (110) characters. Fact rules: a comparison word right after a diff (`67 m later`, `7 km/h lower`, also more, less, faster, slower) must be that diff's `*_word`; any other later, earlier, late, early, higher or lower must match a passing `*_word` of its kind (advice like "Brake later" on an earlier-braking loss is rejected, because it cannot be told apart from a reversed fact); when a note cites both `X_a` and `X_b`, driver A's comes first; and a note names only causes whose display fields passed (brake words need `brake_word`, apex and minimum need `min_speed_*`, exit needs `exit_speed_*`, speed, carry, higher and lower need either), so a `time_only` note gives no reason at all.
- Template notes, cause-aware, built only from display strings: `T1, you gain 0.406 s. You brake 67 m later.`, `T6-7, you lose 0.150 s. Minimum speed 124 km/h against 131 km/h.`, `T9, you lose 0.243 s. Exit speed 144 km/h against 153 km/h.`, `T11, you gain 0.179 s.` (time_only).
- `POST /api/notes` with body exactly `{ "session_id", "a", "b" }` (IDs only; any other key is a 400; never insight JSON from the browser). The server loads the laps from `public/demo/` or `public/data/`, rebuilds the insight, checks per-IP limit and daily spend ledger, then calls the model or returns templates. Response 200: `{ "notes": [{ "finding_id", "text", "source": "model" | "template" }], "cached": boolean, "template_reason": null | "no_key" | "disabled" | "rate_limited" | "spend_cap" | "model_error" }`. `template_reason` is set when every note is a template for that reason; it is null when the model route ran (single notes can still be templates after failing validation twice). Errors: `{ "error", "message" }` with 400 `bad_request` or `same_lap` or `different_track`, 403 `model_not_allowed` (a `fastf1` session or lap), 404 `not_found`, 413 `too_large` (body over 2048 bytes: a larger `Content-Length` is refused before reading, and a stream is cancelled once it passes 2048 bytes), 500 `server_error`. Every response is `Cache-Control: no-store`.
- Without `ANTHROPIC_API_KEY`, the route uses template notes and says so (`source: "template"`, `template_reason: "no_key"`); tests use `FakeNotesClient`. No model call happens on page load; only the "Write notes" action calls the route.
- Model: `claude-haiku-4-5-20251001`, structured outputs, temperature 0, max_tokens 800, timeout 20 s, no SDK retry (`maxRetries: 0`, so one call is one billed HTTP request and the spend ledger's one reservation per call covers it). Any other model needs Nate's OK. Failure policy: at most 2 calls, so at most 2 HTTP requests per route request (1 retry with the validator errors, which reserves its own budget), then a template per failed note; infrastructure failures give templates and are not cached.
- Cache key: sha256 of canonical insight JSON (keys sorted, no whitespace) + `\n` + model id + `\n` + `PROMPT_VERSION`. Records (`race-engineer.notes/v1`) hold `key, model, prompt_version, validator_version, session_id, a, b, notes, usage`. In-memory LRU per instance; `.cache/notes/<key>.json` in development only. Stored notes are re-validated on read.
- Limits, per instance: 5 generations per IP per 10 min. The IP is `x-vercel-forwarded-for` only on Vercel (`VERCEL=1`), whose edge overwrites the client IP headers; anywhere else it is the rightmost `x-forwarded-for` hop (the one the proxy in front appended), then `x-real-ip`. A self-hosted deploy must sit behind a proxy that appends `x-forwarded-for`; bare `next start` lets a client set it, and then only the spend cap limits calls. The limiter holds at most 10,000 IPs (least recently used dropped) and sweeps expired ones at most once a minute; daily spend ledger reset at 00:00 UTC, cap `NOTES_DAILY_SPEND_CAP_USD` (default 0.50); `NOTES_ENABLED=false` (or `0`, `off`, `no`) forces templates; an Anthropic spend-limit error stops calls until the next UTC day.
- `fixtures/notes/` (committed) holds, per ordered `public/demo` pair, one `*.fake.json` record from `FakeNotesClient` (labelled fake; not model output) and one `*.template.json` record. `node scripts/check-notes.ts --write-fixtures` rewrites them.

## 7. Copy rules (all UI text, README, portfolio)

No em dashes or en dashes. Never: leverage (verb), delve, landscape, showcase, pivotal, seamless, robust, empower, unlock, transform. Sentence case, short sentences, active voice. Every claim carries a number or `[needs a number]`. `scripts/copy-lint.ts` enforces the mechanical parts.

F1 marks: never in the product name. "Formula 1" only as a modifier ("Formula 1 qualifying laps"), never as a noun or possessive, never as a title's first word. Grand Prix event names in BLOCK CAPITALS in the session picker (`HUNGARIAN GRAND PRIX 2026`). The line `Unofficial. Not affiliated with Formula 1.` appears on every page; F1's full disclaimer appears in the home page footer. Error pages carry it too: `app/error.tsx` and `app/global-error.tsx` for App Router errors, and `pages/500.tsx` (the static `500.html`) and `pages/_error.tsx` for errors Next.js handles outside the App Router, such as the 400 for a URL segment it cannot decode (`%E0%A4%A`). `pages/` holds only these error pages; without it those two responses came from Next's own components with no app bar.

## 8. Commands

`pnpm check` runs lint, typecheck, format check, vitest, Python unittest, lap validation, note check, copy lint. `pnpm build` is separate. `pnpm e2e` runs the Playwright suite against a production build on port 3106 (desktop 1440x900 and phone 390x844; F1 tests skip when `public/data/` is absent, as in CI); `pnpm e2e:install` fetches Chromium into `node_modules`. CI runs `pnpm check`, `pnpm build` and, in a separate job, `pnpm e2e`. `pnpm verify:data` runs the same checks on local real data in `public/data/`.

Under Next 16.3.6 Turbopack dev, the `pages/` error pages crash with "Invalid hook call" once an App Router page has compiled. Check them with `pnpm build && pnpm start`.
