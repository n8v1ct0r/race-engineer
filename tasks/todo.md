# AI Race Engineer: task list

Source of truth for scope: `docs/phase-1-plan.md`. Each phase ends with a stop and report.

## Phase 1: Plan (no code)
- [x] Data source terms researched and quoted
- [x] Lap schema drafted (Photoncar lap.v0 field names kept)
- [x] Corner detection and analysis method measured on real data
- [x] Chart library benchmarked and chosen (uPlot)
- [x] Visual system proposed (6 colors, 2 typefaces, type scale), contrast recomputed
- [x] File tree
- [x] Session candidates swept (62 sessions)
- [x] Nate decided D0 to D5 and approved Phase 1 (2026-09-23): tolerance kept small, template notes on F1 laps, name "AI Race Engineer", 4 sessions, all 4 deps

## Phase 2: Build the MVP
- [x] Scaffold: Next 16, strict TS, Tailwind v4 tokens, ESLint, Prettier, vitest, CLAUDE.md, .gitignore, CI skeleton (`.github/workflows/ci.yml` added in the integration pass; its commands pass in a fresh clone, but it has not run on GitHub yet)
- [x] lap-schema.json, synthetic.py, validate-laps.ts
- [x] Python reference analysis + unittest
- [x] TS analysis mirrored 1:1 + parity test on the synthetic pair (every float bit-identical on 3 synthetic cases)
- [x] export_sessions.py for the chosen sessions; every lap validates (4 sessions, 763 laps, 0 failures)
- [x] Local real-pair parity (`pnpm verify:data`: 4 default pairs bit-identical)
- [x] UI: picker, synced charts, track map + 25 mini-sectors, ghost replay, corner table
- [x] Notes: insight builder, templates, validator, check-notes.ts, model route + limits + cache (mocked tests)
- [x] Report test count, pass rate, build output (below)

### Last check results (integration pass, 2026-09-24)
- `pnpm check`: exit 0. Lint and typecheck clean, Prettier clean, vitest 146 of 146 in 13 files, Python unittest 21 of 21, lap validation 766 laps and 5 tracks with 0 failures, note check 113 notes with 0 numbers missing from the insight, copy lint 23 files with 0 findings.
- `pnpm build`: exit 0. Static `/`, `/about`, `/demo`; dynamic `/api/notes`; 4 SSG session pages.
- `pnpm verify:data`: exit 0. Parity on all 4 default pairs (21492, 25153, 27221 and 28385 floats bit-identical); corner rows and mini-sectors sum to the lap gap.
- Fresh clone with no `public/data/` (what CI sees): `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm build` all exit 0; the session route prerenders 0 pages.
- Browser (gstack browse, `pnpm dev`): home to 2026 Hungary Q renders 5 charts, the map, the corner table and 6 notes. Hovering puts all 5 chart cursors and the map marker on one index. Changing lap B, clicking a corner, play, pause and keyboard scrub all work. `/demo` Write notes gives template notes and the no-key reason. `/about` and the 404 page render. At 390x844, home, `/demo` and all 4 session pages have no horizontal scroll. Console: 0 errors and 0 warnings, except the browser's own 404 line on the 404 page, which is the correct status. The production build (`pnpm start`) was also clean on `/`, `/demo`, one session page and `/about`.

### Review fixes (2026-09-24)
26 review findings: 24 fixed, 2 fixed in part with the rest left for Nate (below). Contract changes are in `docs/contracts.md` sections 1, 3 to 7.
- Notes: validator `numcheck-v3` (own time required next to lap-level numbers, comparison words and A-then-B order match the data, cause words need their fields), prompt `notes-v3`, no SDK retry, per-IP key trusts Vercel headers only on Vercel, bounded limiter, 2048-byte body cap read without buffering, notes bundle traces only `public/data/manifest.json`.
- Data: `validate-laps` fails when `t_ms` does not span `duration_ms` or sectors do not sum to it; lap meta carries the raw top speed; `formatPercent` twins; parity and verify-data check -0 and NaN before the JSON round trip; verify-data no longer prints the real lap gap.
- UI: focus clears the sticky readout, source order follows the eye at both widths, charts take arrow keys, Play runs with the map partly out of view, pause survives a lap load, Write notes keeps focus, scrub End stops at the real lap end, same-lap and fallback messages, map turned to its axis with non-overlapping labels, 44 px note links, `pages/` error pages carry the disclaimer.
- Checks: `pnpm check` exit 0 (vitest 167 of 167 in 14 files, Python 21 of 21, 766 laps valid, 113 notes 0 missing, copy lint 32 files 0 findings); `pnpm build` exit 0; `pnpm verify:data` exit 0 (4 of 4 pairs parity ok).

### Open after Phase 2 (resolved in Phase 3 unless noted)
- Throttle sentinel: resolved. Samples above 100 (all raw 104) are null and the lap is flagged; 779 laps exported, 2 rejected (0 m distance), 16 laps recovered.
- Low-confidence anchor flag: kept (31% of laps; all 4 default pairs clean).
- Reduced motion: verified by Playwright (e2e/motion.spec.ts).
- Faint mini-sectors: now drawn thin at full color (3 px, not 40% opacity), which passes 3:1 non-text contrast.
- Still open for Nate (Phase 5): the Phase 1 session table of real lap times and the private brief link in docs/phase-1-plan.md; real timing values in git history from cfd39fe (propose a squash before the first push).
- Still open: no live Claude call (needs ANTHROPIC_API_KEY in .env.local).

## Phase 3: Polish (polish bar items 1 to 11)
- [x] Audit: 4 auditors, 37 findings (4 high, 9 medium, 24 low)
- [x] UI fixes (loading feedback on lap and session change, lap select truncation, map label placement, focus, copy)
- [x] Data fix: throttle sentinel to null
- [x] Playwright e2e suite (90 tests at 1440 and 390; CI job added, not yet run on GitHub)
- [x] Verifier round 1 + fix round 2 + verifier round 2
- [x] Orchestrator fixes after verification: phone readout overflow in distance mode (+ regression test), gap-chart labels on Paper boxes, thin faint mini-sectors, header sentence server-rendered for LCP, inline CSS
- [x] Lighthouse CLI 13.4.1 (all 4 categories) on / and /f1/2026/budapest/q

### Phase 3 last check results (2026-09-25)
- `pnpm check`: exit 0. vitest 195 of 195, Python 30 of 30, 782 laps and 5 tracks valid, 113 notes with 0 missing numbers, copy lint 34 files with 0 findings.
- `pnpm build`: exit 0. `pnpm verify:data`: exit 0 (4 of 4 pairs bit-identical).
- `pnpm e2e`: 90 of 90.
- Lighthouse (mobile, simulated Slow 4G): compare page Performance 97, 97, 94 over 3 runs (95 before the fixes), Accessibility, Best Practices and SEO 100; home 98/100/100/100. Desktop: 100 in all 4 categories on both pages.

## Ship (2026-11-05, branch `ship`)
Nate's decision today: exactly 1 real session (2026 Hungary Q) deployed publicly, labeled RECORDED · FastF1; F1 data still never committed; notes on F1 laps stay template-based.
- [x] Home lands in the comparison (featured session `2026-11-q`, else the demo) with the ghost replay running; picker moved to `/sessions`
- [x] Team radio: one call per finding, placed at the corner exit, from display strings and grid time only (`lib/ui/radio.ts` + test); on-air card while the replay runs; click zooms the charts
- [x] Shared honesty strip (`components/honesty-strip.tsx`), dark night palette by default
- [x] e2e: radio spec added; width checks allow the 15 px scrollbar gutter this Chromium now reserves (failed on the unchanged Phase 3 build too)
- [x] `scripts/stage-deploy.sh 2026-11-q <dir>` stages code plus that one session for Vercel
- [x] Vercel project `race-engineer` created and linked; preview deploy built (Ready)
- [ ] Production promote: denied by the permission system in the agent session (needs Nate)
- [ ] Public code repo: blocked, no private term list (deny-list) for this repo found on disk

## Phase 4: Screenshots and portfolio kit
## Phase 5: Publish (ask first)
## Phase 6: Deploy (optional, ask first)
