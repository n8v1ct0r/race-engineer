# AI Race Engineer

Two qualifying laps, compared corner by corner. Code computes every number: the time won or lost at each corner, braking points, minimum and exit speeds, and 25 mini-sectors. A ghost replay runs both laps on the track map, and team radio calls come in as the cars pass each corner. Click a call and the charts zoom to that corner.

Live demo: https://race-engineer-tau.vercel.app

Unofficial. Not affiliated with Formula 1.

## What is real and what is not

- The live demo shows 1 past Formula 1 qualifying session, loaded through [FastF1](https://github.com/theOehrly/Fast-F1) and replayed. The strip at the top says `RECORDED · FastF1`.
- No Formula 1 timing data is in this repo. Exported sessions live in `public/data/`, which git ignores. A fresh clone runs on the synthetic demo in `public/demo/`: made-up laps on a made-up track, labeled `SIMULATED`.
- Radio calls and notes on real laps are written by code from the computed numbers. No model sees Formula 1 numbers. Claude writes notes only for synthetic laps, and only when a server has a key. With no key, the notes route answers with the code-written notes and says so.
- Every number in a call or note must match a value the analysis computed. `scripts/check-notes.ts` and `lib/ui/radio.test.ts` check it.

## Run it

Node 22.18 or later and pnpm 10.

```sh
pnpm install
pnpm dev            # http://localhost:3000, synthetic demo
pnpm check          # lint, types, format, unit tests, lap validation, note check, copy lint
pnpm build
pnpm e2e:install && pnpm e2e
```

Real sessions: set up `pipeline/.venv` with FastF1, then `pnpm export`. Read the FastF1 and data source terms first.

## How it works

- `lib/analysis/`: aligns two laps on a shared 2 m grid, splits the lap into corner rows, and finds the top gains and losses. A Python twin in `pipeline/` gives bit-identical results.
- `lib/ui/radio.ts`: turns each finding into a radio call, placed at its corner exit.
- `components/`: synced uPlot charts, track map, ghost replay, team radio, corner table.

## License

MIT, as set in `package.json`.

This website is unofficial and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.
