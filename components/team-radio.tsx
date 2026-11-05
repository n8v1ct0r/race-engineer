"use client";

// Team radio: the race engineer's calls come in as the ghost replay passes each corner's exit.
// Each call is one finding: the corner, the time won or lost, and the braking or speed numbers
// behind it, all display strings from the analysis. Clicking a call moves the shared cursor to
// that corner and zooms the charts to it. Under reduced motion every call shows at once.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { Comparison } from "@/lib/analysis/index.ts";
import { useCursorStore } from "@/lib/cursor-store.ts";
import { cursorPoint } from "@/lib/ui/geometry.ts";
import { nextHeardM, radioCalls } from "@/lib/ui/radio.ts";
import { NoteText } from "./engineer-notes";

const REDUCED = "(prefers-reduced-motion: reduce)";

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(REDUCED);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

/** A drawn radio level meter: fixed bar heights, the same on every call. */
function Wave() {
  const bars = [4, 9, 6, 12, 7, 10, 5];
  return (
    <svg className="radio-wave" width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
      {bars.map((h, k) => (
        <rect key={k} x={k * 3} y={(14 - h) / 2} width="2" height={h} rx="1" />
      ))}
    </svg>
  );
}

type Props = {
  c: Comparison;
  codeA: string;
  codeB: string;
  /** The corner row the charts are zoomed to, or null. */
  selected: number | null;
  onCall: (cornerIndex: number) => void;
};

export function TeamRadio({ c, codeA, codeB, selected, onCall }: Props) {
  const store = useCursorStore();
  const reduced = useReducedMotion();
  const calls = useMemo(() => radioCalls(c, codeA, codeB), [c, codeA, codeB]);
  const [heardM, setHeardM] = useState(0);
  const heard = useRef(0);
  // True while the ghost replay drives the cursor. The on-air card shows only then, so it never
  // sits over the charts once a person takes over.
  const [onAir, setOnAir] = useState(false);

  useEffect(() => {
    const update = () => {
      const snap = store.get();
      const p = cursorPoint(c, snap);
      const next = nextHeardM(heard.current, p.a.s_m, c.L_m, snap.source === "replay");
      // Re-render only when a call starts or stops showing, not on every replay frame.
      const before = calls.filter((x) => x.triggerM <= heard.current).length;
      const after = calls.filter((x) => x.triggerM <= next).length;
      heard.current = next;
      if (before !== after) setHeardM(next);
      setOnAir(snap.source === "replay");
    };
    return store.subscribe(update);
  }, [store, c, calls]);

  const shown = reduced ? calls : calls.filter((x) => x.triggerM <= heardM);
  const latest = shown.length > 0 ? shown[shown.length - 1] : undefined;
  // Newest call on top, so the one that just came in sits under the replay controls.
  const ordered = [...shown].reverse();

  const live = onAir && !reduced ? latest : undefined;

  return (
    <div className="flex flex-col gap-3" data-team-radio>
      {live ? (
        // The on-air card, like a broadcast radio caption: the newest call over the page while
        // the replay runs. It repeats a call in the log below, so screen readers skip it there.
        <button
          key={live.id}
          type="button"
          data-radio-overlay={live.label}
          className="radio-onair"
          onClick={() => onCall(live.cornerIndex)}
          aria-label={`${live.label}, ${live.delta}. Show on charts`}
        >
          <span className="flex items-center gap-2 text-meta">
            <Wave />
            <span className="font-bold tracking-wide text-driver-a">ENGINEER TO {codeA}</span>
            <span className="font-mono text-graphite">{live.at}</span>
          </span>
          <span className="text-body">
            <NoteText text={live.text} />
          </span>
          {live.facts.map((f) => (
            <span key={f} className="text-meta text-graphite">
              <NoteText text={f} />
            </span>
          ))}
          <span className="text-meta text-graphite underline underline-offset-2">
            Zoom the charts to this corner
          </span>
        </button>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-control font-bold">Team radio</h3>
        <span className="font-mono text-data text-graphite">
          {shown.length} of {calls.length}
        </span>
      </div>
      {calls.length === 0 ? (
        <p className="text-body text-graphite">
          No corner differs enough for a call. These laps are too close to call corner by corner.
        </p>
      ) : shown.length === 0 ? (
        <p className="text-meta text-graphite">
          Calls come in as the replay passes each corner. It runs while the map is in view, or press
          Play.
        </p>
      ) : null}
      <ol
        role="log"
        aria-live="polite"
        aria-label="Team radio calls"
        className="flex flex-col border-t border-rule empty:border-t-0"
      >
        {ordered.map((call) => (
          <li key={call.id}>
            <button
              type="button"
              data-radio-call={call.label}
              data-corner-index={call.cornerIndex}
              className={`radio-call${!reduced && call.id === latest?.id ? " is-new" : ""}`}
              aria-pressed={selected === call.cornerIndex}
              onClick={() => onCall(call.cornerIndex)}
            >
              <span className="row-span-2 pt-1">
                <Wave />
              </span>
              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta">
                <span className="font-bold tracking-wide text-driver-a">ENGINEER TO {codeA}</span>
                <span className="font-mono text-graphite">{call.at}</span>
                <span className="font-bold text-ink">{call.label}</span>
                <span className="font-mono text-ink" data-radio-delta>
                  {call.delta}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-body">
                  <NoteText text={call.text} />
                </span>
                {call.facts.map((f) => (
                  <span key={f} className="text-meta text-graphite">
                    <NoteText text={f} />
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
