"use client";

// Live values at the shared cursor, in the mono face because code computed them. The visible
// readout follows every frame; a separate polite live region speaks only after a person stops
// moving the cursor for 600 ms, so screen readers are not flooded. The readout is sticky, so its
// size must not follow its values: labels sit above values on one line each, and each mono value
// starts at a fixed place and keeps a fixed width in ch, so a longer number never wraps a label,
// moves its own start or pushes its neighbors.

import { useEffect, useState } from "react";
import {
  formatDistance,
  formatLapTime,
  formatPercent,
  formatSpeed,
  formatTime,
  roundHalfAway,
  type Comparison,
  type GridTrace,
} from "@/lib/analysis/index.ts";
import { isUserSource, useCursor, useCursorStore } from "@/lib/cursor-store.ts";
import { cursorPoint, type CarPoint, type CursorPoint } from "@/lib/ui/geometry.ts";
import { DriverMark, type Slot } from "./marks";

const SPEAK_AFTER_MS = 600;

type Channels = { speed: string; gear: string; throttle: string; brake: string; at: string };

/** Display strings for one car. Speed and position come from the cursor point (geometry.ts);
 * throttle, gear and brake from the nearest grid sample. Every number goes through format.ts. */
function channels(tr: GridTrace, car: CarPoint): Channels {
  const i = Math.max(0, Math.min(tr.t_ms.length - 1, Math.floor(car.f + 0.5)));
  const thr = tr.throttle_pct[i];
  const gear = tr.gear[i];
  const brake = tr.brake[i];
  return {
    speed: formatSpeed(roundHalfAway(car.speed_kph)),
    gear: gear === null || gear === undefined ? "no data" : String(gear),
    throttle: thr === null || thr === undefined ? "no data" : formatPercent(roundHalfAway(thr)),
    brake: brake === null || brake === undefined ? "no data" : brake ? "on" : "off",
    at: formatDistance(roundHalfAway(car.s_m)),
  };
}

/** Gap at the cursor, as words: "AAA ahead 0.123 s" or "AAA ahead 33 m". */
function gapText(p: CursorPoint, codeA: string, codeB: string): string {
  if (p.mode === "distance") {
    const ms = roundHalfAway(p.delta_ms ?? 0);
    if (ms === 0) return "Level";
    return `${ms > 0 ? codeA : codeB} ahead ${formatTime(ms)}`;
  }
  const m = roundHalfAway(p.a.s_m - p.b.s_m);
  if (m === 0) return "Level";
  return `${m > 0 ? codeA : codeB} ahead ${formatDistance(m)}`;
}

function sentence(p: CursorPoint, codeA: string, codeB: string, a: Channels, b: Channels): string {
  const where =
    p.mode === "distance"
      ? `At ${a.at}`
      : `At ${formatLapTime(roundHalfAway(p.t_ms ?? 0))}, ${codeA} at ${a.at}, ${codeB} at ${b.at}`;
  return `${where}. ${codeA} ${a.speed}, ${codeB} ${b.speed}. ${gapText(p, codeA, codeB)}.`;
}

function DriverLine({
  slot,
  code,
  ch,
  time,
}: {
  slot: Slot;
  code: string;
  ch: Channels;
  time: boolean;
}) {
  return (
    <div className="flex items-baseline gap-x-3 whitespace-nowrap">
      <span className="inline-flex w-14 items-center gap-1.5 text-control font-bold">
        <DriverMark slot={slot} />
        {code}
      </span>
      <span className="inline-block min-w-[8ch] font-mono text-readout">{ch.speed}</span>
      {time ? (
        <span className="font-mono text-data">
          at <span className="inline-block min-w-[6ch]">{ch.at}</span>
        </span>
      ) : null}
      <span className="hidden text-meta text-graphite lg:inline">
        gear{" "}
        <span className="inline-block min-w-[2ch] font-mono text-data text-ink">{ch.gear}</span>
      </span>
      <span className="hidden text-meta text-graphite lg:inline">
        throttle{" "}
        <span className="inline-block min-w-[4ch] font-mono text-data text-ink">{ch.throttle}</span>
      </span>
      <span className="hidden text-meta text-graphite lg:inline">
        brake{" "}
        <span className="inline-block min-w-[3ch] font-mono text-data text-ink">{ch.brake}</span>
      </span>
    </div>
  );
}

export function CursorReadout({
  c,
  codeA,
  codeB,
}: {
  c: Comparison;
  codeA: string;
  codeB: string;
}) {
  const store = useCursorStore();
  const snap = useCursor(store);
  const p = cursorPoint(c, snap);
  const a = channels(c.grid.a, p.a);
  const b = channels(c.grid.b, p.b);
  const text = sentence(p, codeA, codeB, a, b);
  const user = isUserSource(snap.source);
  const [spoken, setSpoken] = useState("");

  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => setSpoken(text), SPEAK_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [text, user]);

  const time = p.mode === "time";
  return (
    // Phone: the first column only ever holds a short value ("1084 m", "0:02.100"), so it sizes
    // to its content and the gap column takes the rest (a "HAM ahead 0.188 s" value needs about
    // 194 px). The gap value may wrap below md rather than push the page sideways.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 md:flex md:items-center md:gap-6">
      <div className="flex shrink-0 flex-col gap-0.5 whitespace-nowrap md:w-40">
        <span className="text-meta text-graphite">{time ? "Lap time" : "Distance"}</span>
        <span className="font-mono text-readout">
          {time ? formatLapTime(roundHalfAway(p.t_ms ?? 0)) : a.at}
        </span>
      </div>
      <div className="order-last col-span-2 flex min-w-0 flex-col gap-0.5 md:order-none md:flex-1 md:gap-1">
        <DriverLine slot="a" code={codeA} ch={a} time={time} />
        <DriverLine slot="b" code={codeB} ch={b} time={time} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 md:w-60 md:shrink-0 md:whitespace-nowrap">
        <span className="text-meta text-graphite">{time ? "On track" : "Gap here"}</span>
        <span className="font-mono text-readout">{gapText(p, codeA, codeB)}</span>
      </div>
      <p className="sr-only-live" aria-live="polite" aria-atomic="true">
        {spoken}
      </p>
    </div>
  );
}
