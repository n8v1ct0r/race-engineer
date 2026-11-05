"use client";

// One row per corner (docs/contracts.md section 4, plan section 3). Values are the display
// strings from lib/analysis; "edge" and "clamped" flags are named, never quoted as numbers.
// The time bar grows from a center axis toward the driver who gained. A click, or Enter on the
// corner button, selects the corner and moves the shared cursor there.

import type { Comparison, CornerRow, DriverCorner } from "@/lib/analysis/index.ts";
import config from "@/analysis-config.json";
import { DriverMark, DriverTag } from "./marks";

/** A cell value. `flag` marks a word such as "edge" in place of a number; the footnote under the
 * table explains each word, so no reason hides in a tooltip that keyboard and touch never reach. */
type Cell = { text: string; note?: string; flag?: boolean };

function brakeCell(d: DriverCorner | null): Cell {
  if (d === null) return { text: "no data", flag: true };
  if (d.brake_s_m === null || d.display.brake === null) {
    return { text: "none", flag: true };
  }
  if (d.brake_at_segment_start) {
    return { text: "on at entry", flag: true };
  }
  return {
    text: d.display.brake,
    note: d.display.brake_gap ? `${d.display.brake_gap} sample gap` : undefined,
  };
}

function minCell(d: DriverCorner | null): Cell {
  if (d === null) return { text: "no data", flag: true };
  if (d.min_edge) return { text: "edge", flag: true };
  return { text: d.display.min_speed };
}

function exitCell(d: DriverCorner | null, row: CornerRow): Cell {
  if (d === null) return { text: "no data", flag: true };
  if (row.exit_clamped) return { text: "clamped", flag: true };
  return { text: d.display.exit_speed };
}

function Value({ cell }: { cell: Cell }) {
  if (cell.flag) {
    return <span className="text-meta text-graphite">{cell.text}</span>;
  }
  return (
    <span className="flex flex-col">
      <span className="font-mono text-data">{cell.text}</span>
      {cell.note ? <span className="text-tick text-graphite">{cell.note}</span> : null}
    </span>
  );
}

/** Bar from a center axis: left toward A when A gains, right toward B when B gains. */
function GainBar({ ms, max }: { ms: number; max: number }) {
  const frac = max > 0 ? Math.min(1, Math.abs(ms) / max) : 0;
  const pct = `${String(frac * 50)}%`;
  return (
    <span aria-hidden="true" className="relative block h-2 w-full min-w-16">
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-graphite" />
      {ms > 0 ? (
        <span className="absolute inset-y-0 bg-driver-a" style={{ right: "50%", width: pct }} />
      ) : null}
      {ms < 0 ? (
        <span className="absolute inset-y-0 bg-driver-b" style={{ left: "50%", width: pct }} />
      ) : null}
    </span>
  );
}

type Props = {
  c: Comparison;
  codeA: string;
  codeB: string;
  selected: number | null;
  onSelect: (index: number) => void;
};

export function cornerRowId(index: number): string {
  return `corner-row-${String(index)}`;
}

export function cornerCardId(index: number): string {
  return `corner-card-${String(index)}`;
}

/** Scroll to whichever corner element is visible (table on desktop, card on phone) and focus it. */
export function revealCorner(index: number) {
  for (const id of [cornerRowId(index), cornerCardId(index)]) {
    const el = document.getElementById(id);
    if (el && el.offsetParent !== null) {
      el.scrollIntoView({ block: "center" });
      el.querySelector<HTMLButtonElement>("button[data-corner]")?.focus({ preventScroll: true });
      return;
    }
  }
}

export function CornerTable({ c, codeA, codeB, selected, onSelect }: Props) {
  const max = Math.max(1, ...c.corners.map((r) => Math.abs(r.delta_ms)));

  if (c.corners.length === 0) {
    return (
      <p className="max-w-[70ch] text-body">
        No corners found on this lap. The speed-minima detector needs a drop of{" "}
        {config.detector.prominence_kph} km/h or more to mark a corner.
      </p>
    );
  }

  const cornerButton = (r: CornerRow) => (
    <button
      type="button"
      data-corner={r.index}
      aria-pressed={selected === r.index}
      aria-label={`${r.label}, ${codeA} ${r.display.delta}. Show on charts and map`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(r.index);
      }}
      className="min-h-11 min-w-12 cursor-pointer rounded-control px-1 text-left font-bold underline decoration-1 underline-offset-[3px] hover:decoration-2 md:min-h-9"
    >
      {r.label}
    </button>
  );

  return (
    <>
      {/* Desktop and tablet: one table. */}
      <table className="hidden w-full border-collapse text-left md:table">
        <caption className="sr-only">
          Corner by corner, {codeA} against {codeB}. Time is from {codeA}&apos;s view.
        </caption>
        <thead className="text-control text-graphite">
          <tr className="border-b border-rule">
            <th scope="col" rowSpan={2} className="py-2 pr-4 align-bottom font-medium">
              Corner
            </th>
            <th scope="col" rowSpan={2} className="py-2 pr-4 align-bottom font-medium">
              Time for {codeA}
            </th>
            <th scope="col" rowSpan={2} className="w-40 py-2 pr-6 align-bottom font-medium">
              <span className="flex justify-between text-tick">
                <span>{codeA} gains</span>
                <span>{codeB} gains</span>
              </span>
            </th>
            <th scope="colgroup" colSpan={2} className="pt-2 pr-4 font-medium">
              Braking point
            </th>
            <th scope="colgroup" colSpan={2} className="pt-2 pr-4 font-medium">
              Minimum speed
            </th>
            <th scope="colgroup" colSpan={2} className="pt-2 font-medium">
              Exit speed
            </th>
          </tr>
          <tr className="border-b border-rule text-meta">
            {[0, 1, 2].flatMap((g) => [
              <th key={`${String(g)}a`} scope="col" className="pb-2 pr-4 font-normal">
                <DriverTag slot="a" code={codeA} />
              </th>,
              <th key={`${String(g)}b`} scope="col" className="pb-2 pr-4 font-normal">
                <DriverTag slot="b" code={codeB} />
              </th>,
            ])}
          </tr>
        </thead>
        {/* Values stay on one line from lg up, where the table has 960 px or more (it needs about
            860); below lg the braking words may wrap to fit 704 px. */}
        <tbody className="lg:whitespace-nowrap">
          {c.corners.map((r) => {
            const on = selected === r.index;
            return (
              <tr
                key={r.index}
                id={cornerRowId(r.index)}
                onClick={() => onSelect(r.index)}
                className={`cursor-pointer border-b border-rule align-top hover:bg-rule-tint ${
                  on ? "bg-rule-tint outline outline-1 -outline-offset-1 outline-ink" : ""
                }`}
              >
                <th scope="row" className="py-2 pr-4 font-normal">
                  {cornerButton(r)}
                </th>
                <td className="py-3 pr-4 font-mono text-data whitespace-nowrap">
                  {r.display.delta}
                </td>
                <td className="py-4 pr-6">
                  <GainBar ms={r.delta_ms} max={max} />
                </td>
                <td className="py-3 pr-4">
                  <Value cell={brakeCell(r.a)} />
                </td>
                <td className="py-3 pr-4">
                  <Value cell={brakeCell(r.b)} />
                </td>
                <td className="py-3 pr-4">
                  <Value cell={minCell(r.a)} />
                </td>
                <td className="py-3 pr-4">
                  <Value cell={minCell(r.b)} />
                </td>
                <td className="py-3 pr-4">
                  <Value cell={exitCell(r.a, r)} />
                </td>
                {/* pr-4 like its header cell, so the selected row's inset outline clears the
                    last value. */}
                <td className="py-3 pr-4">
                  <Value cell={exitCell(r.b, r)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Phone: stacked rows, no horizontal scroll. */}
      <ol className="flex flex-col md:hidden">
        {c.corners.map((r) => {
          const on = selected === r.index;
          const rows: [string, Cell, Cell][] = [
            ["Braking point", brakeCell(r.a), brakeCell(r.b)],
            ["Minimum speed", minCell(r.a), minCell(r.b)],
            ["Exit speed", exitCell(r.a, r), exitCell(r.b, r)],
          ];
          return (
            <li
              key={r.index}
              id={cornerCardId(r.index)}
              onClick={() => onSelect(r.index)}
              className={`flex flex-col gap-2 border-b border-rule px-1 py-3 ${
                on ? "bg-rule-tint outline outline-1 -outline-offset-1 outline-ink" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                {cornerButton(r)}
                <span className="font-mono text-data">{r.display.delta}</span>
                <span className="ml-auto w-24">
                  <GainBar ms={r.delta_ms} max={max} />
                </span>
              </div>
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="sr-only">Driver</dt>
                <dd className="col-start-2 flex items-center gap-1.5 text-meta">
                  <DriverMark slot="a" />
                  <span className="font-bold">{codeA}</span>
                </dd>
                <dd className="flex items-center gap-1.5 text-meta">
                  <DriverMark slot="b" />
                  <span className="font-bold">{codeB}</span>
                </dd>
                {rows.map(([name, ca, cb]) => [
                  <dt key={`${name}-t`} className="text-meta text-graphite">
                    {name}
                  </dt>,
                  <dd key={`${name}-a`}>
                    <Value cell={ca} />
                  </dd>,
                  <dd key={`${name}-b`}>
                    <Value cell={cb} />
                  </dd>,
                ])}
              </dl>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex max-w-[80ch] flex-col gap-1 text-meta text-graphite">
        <p>
          Braking point is in meters before the corner&apos;s first marker. The sample gap is its
          resolution, so a difference counts only when it is larger than both gaps. None: no brake
          before this corner. On at entry: the brake was already on where the corner starts.
        </p>
        <p>
          Edge: the lowest speed sits on the segment boundary, so the corner is taken flat. Clamped:
          the exit point, {config.corners.exit_offset_m} m after the last marker, ran into the next
          corner. Neither is quoted as a number. No data: the lap has no samples in this corner.
        </p>
      </div>
    </>
  );
}
