# CLAUDE.md: race-engineer

AI Race Engineer: pick a Formula 1 qualifying session and 2 drivers, see where the lap was won and lost corner by corner. Code computes every number; a model writes short radio-style notes from those numbers only.

Read first: `tasks/todo.md` (status), `docs/contracts.md` (interfaces), `docs/phase-1-plan.md` (why).

## Stack

Next.js 16.3.6 (App Router, Turbopack), React 19.3.0, TypeScript 5.9.3 strict, Tailwind CSS 4.3.3 (CSS-first `@theme`, no config file), uPlot 1.6.32, vitest 5.0.1, ajv 8.20.0, @anthropic-ai/sdk 0.128.0. Python 3.14 with FastF1 3.8.3 for the export only (venv at `pipeline/.venv`). Node >= 22.18 runs `.ts` scripts directly (type stripping), so:

- Relative imports inside `lib/` and `scripts/` use explicit `.ts` extensions.
- No TS-only runtime syntax (`erasableSyntaxOnly`): no enums, namespaces, parameter properties.

Pinned on purpose: typescript 5.9.3 (7.x breaks typescript-eslint), eslint 9.39.5 (10.x breaks the Next plugins). Do not bump.

## Hard rules

1. Never commit Formula 1 derived data. `public/data/` and `.cache/` are gitignored. Tests, CI and the demo run on the synthetic session in `public/demo/`. Nate's 2026-11-05 decision: exactly 1 session (2026 Hungary Q) is deployed publicly, labeled RECORDED · FastF1 in the honesty strip. It is deployed by `scripts/stage-deploy.sh`, never committed.
2. Never send Formula 1 derived numbers to a model. Claude writes notes only for `synthetic` and `photoncar` laps.
3. Never use F1 or team logos, fonts, or livery. Driver colors are the two neutral inks from the visual system.
4. `Unofficial. Not affiliated with Formula 1.` on every page.
5. Code computes every number. Every number in a note must appear in the insight data; `scripts/check-notes.ts` checks it.
6. Follow the copy rules in `docs/contracts.md` section 7.
7. Secrets only in `.env.local`. `.env.example` holds names only.
8. The Phase 1 brief's private term list never goes into any file in this repo.

## Commands

- `pnpm dev`, `pnpm build`
- `pnpm check`: lint, typecheck, format check, vitest, Python unittest, lap validation, note check, copy lint
- `pnpm synthetic`: regenerate `public/demo/` and `fixtures/parity/`
- `pnpm export`: export the chosen F1 sessions to `public/data/` (needs `pipeline/.venv`)
- `pnpm verify:data`: checks on local real data
- `pnpm e2e`: Playwright suite on a production build (`pnpm e2e:install` first; Chromium lands in `node_modules`, never `~/Library`)
- Lighthouse: the chrome-devtools MCP `lighthouse_audit` omits Performance; the full score needs the Lighthouse CLI (`CHROME_PATH` to the Playwright Chromium)
- Next 16.3.6 Turbopack dev crashes the `pages/` error pages; check them with `pnpm build && pnpm start`

## Visual system: Plot sheet

Dark by default since 2026-11-05 (night sheet): Paper `#0D0F13`, Ink `#E8EBF0`, Graphite `#9BA2AD`, Rule `#2B3038`, Driver A violet `#A88BEB`, Driver B amber `#E3A845`. The light Plot sheet values are in git history. Atkinson Hyperlegible Next for words, Atkinson Hyperlegible Mono for computed values. Details in `docs/phase-1-plan.md` section 5. Tokens live in `app/globals.css`.
