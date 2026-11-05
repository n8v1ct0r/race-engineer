"use client";

// The shared honesty strip from nate-victor.com (shared/STRIP.md): who built this, which
// sidequest, and what kind of data is on screen. Real Formula 1 timing replayed from FastF1 is
// RECORDED. The synthetic demo, and any copy of this app without exported sessions, is SIMULATED.

import { usePathname } from "next/navigation";

const KINDS = {
  recorded: {
    text: "RECORDED · FastF1",
    dot: "#F5B83D",
    title:
      "Real timing from one past qualifying session, loaded through FastF1 and replayed. Notes are written by code from the computed numbers.",
  },
  simulated: {
    text: "SIMULATED · synthetic laps",
    dot: "#9B8CFF",
    title: "Made-up laps on a made-up track. No real timing data.",
  },
} as const;

export function HonestyStrip({ hasF1Data }: { hasF1Data: boolean }) {
  const path = usePathname() ?? "/";
  const kind = !hasF1Data || path.startsWith("/demo") ? KINDS.simulated : KINDS.recorded;
  return (
    <div data-honesty-strip className="honesty-strip">
      <a href="https://nate-victor.com">NATE VICTOR / SIDEQUEST 04</a>
      <span className="hs-center" aria-hidden="true">
        ·
      </span>
      <span className="hs-center">AI RACE ENGINEER</span>
      <span className="hs-label" title={kind.title}>
        <span className="hs-dot" style={{ background: kind.dot }} aria-hidden="true" />
        {kind.text}
      </span>
    </div>
  );
}
