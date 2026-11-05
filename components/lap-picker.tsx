"use client";

// Driver and lap selects for one slot. Default is the driver's fastest lap; any lap that passed
// exporter QA can be picked. An option names only the lap, its time, and "fastest" or "deleted",
// so the closed select never cuts its text off. Segment, tyre and every flag with its reason show
// as text under the selects.

import { useId, type Ref } from "react";
import { formatLapTime } from "@/lib/analysis/index.ts";
import {
  driversByPace,
  fastestLap,
  findLap,
  flagReason,
  lapFacts,
  lapFlags,
  type ManifestLap,
  type Session,
} from "@/lib/data.ts";
import { DriverMark, type Slot } from "./marks";

function optionText(lap: ManifestLap, fastestId: string | null): string {
  const parts = [`Lap ${String(lap.lap_no)}`, formatLapTime(lap.duration_ms)];
  if (lap.lap_id === fastestId) parts.push("fastest");
  if (lap.deleted === true) parts.push("deleted");
  return parts.join(", ");
}

type Props = {
  slot: Slot;
  session: Session;
  lapId: string;
  onChange: (lapId: string) => void;
  /** The lap select, for callers that move focus to it. */
  lapRef?: Ref<HTMLSelectElement>;
};

export function LapPicker({ slot, session, lapId, onChange, lapRef }: Props) {
  const id = useId();
  const ref = findLap(session, lapId);
  const drivers = driversByPace(session);
  const driver = ref?.driver ?? drivers[0] ?? null;
  const fastest = driver ? fastestLap(driver) : null;
  const laps = driver ? [...driver.laps].sort((x, y) => x.duration_ms - y.duration_ms) : [];
  const lap = ref?.lap ?? null;
  const facts = lap ? lapFacts(lap) : [];
  const flags = lap ? lapFlags(lap) : [];
  const name = slot === "a" ? "Lap A" : "Lap B";

  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="flex items-center gap-1.5 text-meta text-graphite">
        <DriverMark slot={slot} />
        {name}
      </legend>
      <div className="flex min-w-0 gap-2">
        <label htmlFor={`${id}-driver`} className="sr-only">
          {name} driver
        </label>
        <select
          id={`${id}-driver`}
          className="select w-24 shrink-0 md:w-20"
          value={driver?.code ?? ""}
          onChange={(e) => {
            const d = session.drivers.find((x) => x.code === e.target.value);
            const best = d ? fastestLap(d) : null;
            if (best) onChange(best.lap_id);
          }}
        >
          {drivers.map((d) => (
            <option key={d.code} value={d.code}>
              {d.code}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-lap`} className="sr-only">
          {name} lap
        </label>
        <select
          id={`${id}-lap`}
          ref={lapRef}
          className="select min-w-0 flex-1"
          value={lapId}
          onChange={(e) => onChange(e.target.value)}
        >
          {laps.map((l) => (
            <option key={l.lap_id} value={l.lap_id}>
              {optionText(l, fastest?.lap_id ?? null)}
            </option>
          ))}
        </select>
      </div>
      {facts.length > 0 || flags.length > 0 ? (
        <ul className="flex flex-wrap gap-x-3 text-meta text-graphite">
          {facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
          {flags.map((f) => {
            const reason = flagReason(f);
            return (
              <li key={f.key}>
                <span className="font-bold text-ink">{f.label}</span>
                {reason ? `: ${reason}` : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </fieldset>
  );
}
