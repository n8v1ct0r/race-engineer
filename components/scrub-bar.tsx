"use client";

// The keyboard path through the lap (plan section 3b item 7): a native range input over lap
// time. Arrows step 0.1 s, Page Up and Page Down 1 s, Home and End jump to the ends. A press or a
// navigation key takes the cursor where it is first, even when the value cannot move (Home at the
// start), so touching the bar always pauses the replay and ends autoplay (ghost-replay.tsx).

import type { KeyboardEvent } from "react";
import { formatLapTime, roundHalfAway, type Comparison } from "@/lib/analysis/index.ts";
import { useCursor, useCursorStore } from "@/lib/cursor-store.ts";
import { cursorTimeMs, replayEndMs } from "@/lib/ui/geometry.ts";

const STEP_MS = 100;
const PAGE_MS = 1000;
/** Keys the range input handles itself. */
const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

export function ScrubBar({ c, id }: { c: Comparison; id: string }) {
  const store = useCursorStore();
  const snap = useCursor(store);
  // The cursor never passes the slower lap's real end; only the input's max is rounded up to a
  // whole step, so End shows a lap time a lap actually has.
  const lapEnd = replayEndMs(c);
  const max = Math.ceil(lapEnd / STEP_MS) * STEP_MS;
  const t = Math.min(lapEnd, Math.max(0, cursorTimeMs(c, snap)));
  const value = t >= lapEnd ? max : Math.floor(t / STEP_MS + 0.5) * STEP_MS;
  const label = formatLapTime(roundHalfAway(t));

  const setTime = (ms: number) => {
    store.set({ mode: "time", tMs: Math.min(lapEnd, Math.max(0, ms)) }, "scrub");
  };

  /** A person has the bar: pin the cursor at the shown time, which stops the replay. */
  const take = () => setTime(t);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      setTime(value + (e.key === "PageUp" ? PAGE_MS : -PAGE_MS));
      return;
    }
    if (NAV_KEYS.has(e.key)) take();
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <input
        id={id}
        type="range"
        className="scrub min-w-0 flex-1"
        min={0}
        max={max}
        step={STEP_MS}
        value={value}
        aria-label="Replay position in lap time"
        aria-valuetext={label}
        onChange={(e) => setTime(Number(e.target.value))}
        onKeyDown={onKeyDown}
        onPointerDown={take}
      />
      <output htmlFor={id} className="w-20 shrink-0 text-right font-mono text-data">
        {label}
      </output>
    </div>
  );
}
