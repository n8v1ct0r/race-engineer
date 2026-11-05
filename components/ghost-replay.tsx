"use client";

// Ghost replay (plan section 5, motion): both cars move along the map at 1x real time, each
// placed by its own elapsed lap time. requestAnimationFrame drives it. It autoplays only when
// reduced motion is off, at least half the map is in view and the tab is visible; it stops for
// good once a person touches play, the scrub bar, a chart or a corner. Play works under reduced
// motion and with the map partly out of view, because the person asked for it. The play state
// lives in CompareView, so it outlives the loading skeleton that replaces this panel while a new
// lap loads.

import { useEffect, useId, useState, useSyncExternalStore, type RefObject } from "react";
import type { Comparison } from "@/lib/analysis/index.ts";
import { isUserSource, useCursorStore } from "@/lib/cursor-store.ts";
import { cursorTimeMs, replayEndMs } from "@/lib/ui/geometry.ts";
import { ScrubBar } from "./scrub-bar";

const REDUCED = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(REDUCED);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED).matches,
    () => true,
  );
}

function usePageVisible(): boolean {
  return useSyncExternalStore(
    (cb) => {
      document.addEventListener("visibilitychange", cb);
      return () => document.removeEventListener("visibilitychange", cb);
    },
    () => document.visibilityState === "visible",
    () => false,
  );
}

function useHalfInView(ref: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setInView(e.intersectionRatio >= 0.5);
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return inView;
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 1.5v11l9.5-5.5z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2.5" y="1.5" width="3" height="11" fill="currentColor" />
      <rect x="8.5" y="1.5" width="3" height="11" fill="currentColor" />
    </svg>
  );
}

/** Play state owned by CompareView. autoplay turns false for good once a person steps in. */
export type ReplayState = { playing: boolean; autoplay: boolean };

type Props = {
  c: Comparison;
  /** The element that must be at least half in view for autoplay (the map). */
  watch: RefObject<HTMLElement | null>;
  replay: ReplayState;
  onReplay: (next: ReplayState) => void;
};

export function GhostReplay({ c, watch, replay, onReplay }: Props) {
  const store = useCursorStore();
  const scrubId = useId();
  const reduced = usePrefersReducedMotion();
  const visible = usePageVisible();
  const inView = useHalfInView(watch);
  const { playing, autoplay } = replay;

  // Only autoplay waits for the map to be in view; a press of Play always runs.
  const running = visible && (playing || (autoplay && !reduced && inView));
  const end = replayEndMs(c);

  // Any person moving the cursor pauses the replay and ends autoplay for this view.
  useEffect(
    () =>
      store.subscribe(() => {
        if (isUserSource(store.get().source)) onReplay({ playing: false, autoplay: false });
      }),
    [store, onReplay],
  );

  useEffect(() => {
    if (!running || end <= 0) return;
    let raf = 0;
    // Timing starts on the first frame: a frame timestamp can be earlier than a
    // performance.now() read before it, which would step the replay backward.
    let last: number | null = null;
    let t = Math.max(0, cursorTimeMs(c, store.get()));
    if (t >= end) t = 0;
    const tick = (now: number) => {
      if (last !== null) t += Math.max(0, now - last);
      last = now;
      if (t > end) t = 0;
      store.set({ mode: "time", tMs: t }, "replay");
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, c, store, end]);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn w-24 shrink-0"
        onClick={() => onReplay({ playing: !running, autoplay: false })}
        aria-controls={scrubId}
      >
        {running ? <PauseIcon /> : <PlayIcon />}
        {running ? "Pause" : "Play"}
      </button>
      <ScrubBar c={c} id={scrubId} />
    </div>
  );
}
