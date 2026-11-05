"use client";

// One session, two laps. Loads the track and lap files from /data/... or /demo/... (static, no
// other network call on page load), runs analyzePair in the browser, and wires the shared
// cursor through the readout, charts, map, replay, corner table and notes. ?a=&b= holds the pair.
// A lap change writes the query with history.replaceState, so the page answers at once with no
// server round trip. Sections sit in the DOM in the order they are seen, so Tab follows the eye at
// every width: map, notes, charts, table on a phone; charts, then map and notes in the right
// column, then the table from lg up. The table spans both columns at lg. From 1440 px wide, where
// column 1 has 893 px or more and the table needs about 860 with every value on one line, it sits
// under the charts and the notes run down beside it, so a long notes column leaves no hole between
// the charts and the table.
//
// CompareHeader (control bar, title, lap times) renders the same in the page's Suspense fallback
// (CompareFallback) and here, so the prerendered HTML carries the heading at its final height.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
import {
  analyzePair,
  formatLapTime,
  type AnalysisConfig,
  type Comparison,
  type Lap,
  type Track,
} from "@/lib/analysis/index.ts";
import { CursorContext, createCursorStore } from "@/lib/cursor-store.ts";
import {
  DataLoadError,
  eventTitle,
  fetchLap,
  fetchTrack,
  findLap,
  formatDate,
  replacedMessage,
  resolvePair,
  type DataRoot,
  type ResolvedPair,
  type Session,
  type SessionChoice,
} from "@/lib/data.ts";
import { indexAtDistance } from "@/lib/ui/geometry.ts";
import { headerNote } from "@/lib/ui/header-note.ts";
import analysisConfig from "@/analysis-config.json";
import { CornerTable, revealCorner } from "./corner-table";
import { CursorReadout } from "./cursor-readout";
import { EngineerNotes } from "./engineer-notes";
import { GhostReplay, type ReplayState } from "./ghost-replay";
import { LapPicker } from "./lap-picker";
import { DriverTag } from "./marks";
import { SessionPicker } from "./session-picker";
import { TeamRadio } from "./team-radio";
import { CompareSkeleton, ErrorPanel } from "./states";
import { ChartLegend, TelemetryCharts } from "./telemetry-charts";
import { TrackMap } from "./track-map";

const config: AnalysisConfig = analysisConfig;

/** One file that did not load, said from the reader's side, with the URL for whoever fixes it. */
type LoadFailure = { text: string; url: string | null; missing: boolean };

type Loaded<T> = { status: "ready"; value: T } | { status: "error"; failure: LoadFailure };

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "Lap HAM-11 did not load (HTTP 404)." from a failed fetch. */
function loadFailure(what: string, err: unknown): LoadFailure {
  if (!(err instanceof DataLoadError)) {
    return { text: `${what} did not load: ${message(err)}`, url: null, missing: false };
  }
  const why = {
    network: ": no answer from the server.",
    http: ` (HTTP ${String(err.status)}).`,
    json: ": the file is not valid JSON.",
    schema: ": the file is not in the race-engineer format.",
  }[err.kind];
  return { text: `${what} did not load${why}`, url: err.url, missing: err.status === 404 };
}

/** Tailwind's lg breakpoint, where the page becomes two columns. */
const WIDE = "(min-width: 64rem)";

function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** Writes the pair to the address bar without a navigation (Next keeps useSearchParams in step). */
function writePairToUrl(a: string, b: string) {
  const q = new URLSearchParams({ a, b });
  window.history.replaceState(null, "", `?${q.toString()}`);
}

type HeaderProps = {
  session: Session;
  choices: SessionChoice[];
  pair: ResolvedPair;
  /** The comparison once it is ready; null while laps load. */
  c: Comparison | null;
  track: Track | null;
  /** The header sentence for the session's default pair, rendered on the server at build time. */
  defaultNote?: string | null;
  controlsOpen: boolean;
  onToggleControls: () => void;
  onPair: (a: string, b: string) => void;
  headingRef?: Ref<HTMLHeadingElement>;
  lapBRef?: Ref<HTMLSelectElement>;
};

/** Control bar and page header. Session choice on the first row, laps on the second. */
export function CompareHeader({
  session,
  choices,
  pair,
  c,
  track,
  defaultNote,
  controlsOpen,
  onToggleControls,
  onPair,
  headingRef,
  lapBRef,
}: HeaderProps) {
  const refA = findLap(session, pair.a);
  const refB = findLap(session, pair.b);
  const codeA = refA?.driver.code ?? pair.a;
  const codeB = refB?.driver.code ?? pair.b;
  const date = formatDate(session.date);
  const where = [session.session_name, session.origin === "fastf1" ? session.location : null, date]
    .filter((x): x is string => Boolean(x))
    .join(" · ");
  // Before the laps load, the default pair's sentence comes from the server, so the page's
  // largest text on phones paints with the first HTML instead of after analysis.
  const isDefault = pair.a === session.default_pair.a && pair.b === session.default_pair.b;
  const note = c ? headerNote(c, track) : isDefault ? (defaultNote ?? null) : null;

  return (
    <>
      <div className="border-b border-rule py-3">
        <div className="flex items-center justify-between gap-3 md:hidden">
          <p className="flex items-center gap-2 text-control">
            <DriverTag slot="a" code={codeA} />
            <span className="text-graphite">and</span>
            <DriverTag slot="b" code={codeB} />
          </p>
          <button
            type="button"
            className="btn"
            aria-expanded={controlsOpen}
            aria-controls="compare-controls"
            onClick={onToggleControls}
          >
            {controlsOpen ? "Done" : "Change"}
          </button>
        </div>
        <div
          id="compare-controls"
          className={`${controlsOpen ? "flex" : "hidden"} mt-3 flex-col gap-4 md:mt-0 md:flex`}
        >
          <SessionPicker choices={choices} current={session.session_id} compact />
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-4">
            <div className="min-w-0 md:w-[26rem] md:min-w-[18rem] md:shrink">
              <LapPicker
                slot="a"
                session={session}
                lapId={pair.a}
                onChange={(id) => onPair(id, pair.b)}
              />
            </div>
            <div className="min-w-0 md:w-[26rem] md:min-w-[18rem] md:shrink">
              <LapPicker
                slot="b"
                session={session}
                lapId={pair.b}
                lapRef={lapBRef}
                onChange={(id) => onPair(pair.a, id)}
              />
            </div>
            {/* The empty line matches the pickers' legend, so Swap lines up with the selects. */}
            <div className="flex shrink-0 flex-col">
              <span aria-hidden="true" className="hidden text-meta md:block">
                &nbsp;
              </span>
              <button
                type="button"
                className="btn self-start"
                disabled={pair.a === pair.b}
                onClick={() => onPair(pair.b, pair.a)}
                aria-label={`Swap laps: put ${codeB} in slot A and ${codeA} in slot B`}
              >
                Swap
              </button>
            </div>
          </div>
        </div>
      </div>

      <header className="border-b border-rule py-4 md:py-5">
        <h1 ref={headingRef} tabIndex={-1} className="text-title">
          {eventTitle(session)}
        </h1>
        <p className="mt-1 text-meta text-graphite">{where}</p>
        <p className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {refA ? (
            <span className="inline-flex items-baseline gap-2">
              <DriverTag slot="a" code={codeA} />
              <span className="font-mono text-readout">{formatLapTime(refA.lap.duration_ms)}</span>
            </span>
          ) : null}
          {refB ? (
            <span className="inline-flex items-baseline gap-2">
              <DriverTag slot="b" code={codeB} />
              <span className="font-mono text-readout">{formatLapTime(refB.lap.duration_ms)}</span>
            </span>
          ) : null}
          {c ? (
            <span className="inline-flex items-baseline gap-2">
              <span className="text-control text-graphite">Lap gap</span>
              <span className="font-mono text-readout">
                {c.display.gap_direction === "level" ? "level" : `${codeA} ${c.display.gap}`}
              </span>
            </span>
          ) : null}
        </p>
        {note !== null ? <p className="mt-2 max-w-[90ch] text-meta text-graphite">{note}</p> : null}
        {pair.replaced.length > 0 ? (
          <p role="status" className="mt-2 text-meta text-ink">
            {replacedMessage(pair.replaced)}
          </p>
        ) : null}
      </header>
    </>
  );
}

type Props = {
  root: DataRoot;
  session: Session;
  choices: SessionChoice[];
  /** Header sentence for the default pair, computed on the server (see lib/ui/header-note.ts). */
  defaultNote?: string | null;
};

/**
 * What the server renders while the page waits for the address bar (useSearchParams): the real
 * header for the session's default pair, then the loading blocks. The browser swaps in
 * CompareView as soon as it runs, at the same height.
 */
export function CompareFallback({
  session,
  choices,
  label,
  defaultNote,
}: {
  session: Session;
  choices: SessionChoice[];
  label?: string;
  defaultNote?: string | null;
}) {
  const [controlsOpen, setControlsOpen] = useState(false);
  const pair = resolvePair(session, null, null);
  return (
    <main id="main" className="mx-auto max-w-[1600px] px-gutter">
      <CompareHeader
        session={session}
        choices={choices}
        pair={pair}
        c={null}
        track={null}
        defaultNote={defaultNote}
        controlsOpen={controlsOpen}
        onToggleControls={() => setControlsOpen((o) => !o)}
        onPair={writePairToUrl}
      />
      <CompareSkeleton label={label} />
    </main>
  );
}

export function CompareView({ root, session, choices, defaultNote }: Props) {
  const params = useSearchParams();
  // The pair a person picked on this page. It wins over the address bar, so the selects change on
  // the same frame as the pick; the address bar follows through writePairToUrl.
  const [picked, setPicked] = useState<{ a: string; b: string } | null>(null);
  // Typed nullable because pages/ exists (for the error pages); on this App Router page the hook
  // always returns a value.
  const qa = picked?.a ?? params?.get("a") ?? null;
  const qb = picked?.b ?? params?.get("b") ?? null;
  const pair = useMemo(() => resolvePair(session, qa, qb), [session, qa, qb]);

  const [store] = useState(() => createCursorStore());
  const [track, setTrack] = useState<Loaded<Track | null> | null>(null);
  const [laps, setLaps] = useState<Record<string, Loaded<Lap>>>({});
  const inflight = useRef(new Set<string>());
  const [selected, setSelected] = useState<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  // Replay state lives here, not in GhostReplay: the skeleton that replaces the panels while a
  // new lap loads would otherwise reset it and restart autoplay after a pause.
  const [replay, setReplay] = useState<ReplayState>({ playing: false, autoplay: true });
  const onReplay = useCallback((next: ReplayState) => setReplay(next), []);
  const mapRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lapBRef = useRef<HTMLSelectElement>(null);
  const loadingRef = useRef<HTMLParagraphElement>(null);
  const tryAgainRef = useRef<HTMLButtonElement>(null);
  // Set by Try again: where focus goes as the retry moves from loading to its result, because the
  // pressed button leaves the page.
  const retrying = useRef(false);
  const wide = useWide();
  const sameLap = pair.a === pair.b;

  const sessionId = session.session_id;
  const needTrack = track === null;
  const trackInflight = useRef(false);
  useEffect(() => {
    if (!needTrack || trackInflight.current) return;
    trackInflight.current = true;
    fetchTrack(root, sessionId).then(
      (t) => {
        trackInflight.current = false;
        setTrack({ status: "ready", value: t });
      },
      (err: unknown) => {
        trackInflight.current = false;
        setTrack({ status: "error", failure: loadFailure("The track file", err) });
      },
    );
  }, [needTrack, root, sessionId]);

  const missing = [pair.a, pair.b].filter((id, k, all) => all.indexOf(id) === k && !(id in laps));
  const missingKey = missing.join("|");
  useEffect(() => {
    if (missingKey === "") return;
    for (const id of missingKey.split("|")) {
      if (inflight.current.has(id)) continue;
      inflight.current.add(id);
      fetchLap(root, sessionId, id).then(
        (lap) => {
          inflight.current.delete(id);
          setLaps((p) => ({ ...p, [id]: { status: "ready", value: lap } }));
        },
        (err: unknown) => {
          inflight.current.delete(id);
          setLaps((p) => ({
            ...p,
            [id]: { status: "error", failure: loadFailure(`Lap ${id}`, err) },
          }));
        },
      );
    }
  }, [missingKey, root, sessionId]);

  const lapA = laps[pair.a];
  const lapB = laps[pair.b];

  const result = useMemo((): { c: Comparison } | { error: string } | null => {
    if (pair.a === pair.b) return null;
    if (track?.status !== "ready" || lapA?.status !== "ready" || lapB?.status !== "ready") {
      return null;
    }
    if (lapA.value.track_id !== lapB.value.track_id) {
      return { error: `${pair.a} and ${pair.b} were driven on different tracks.` };
    }
    try {
      return { c: analyzePair(lapA.value, lapB.value, track.value, config) };
    } catch (err) {
      return { error: message(err) };
    }
  }, [track, lapA, lapB, pair.a, pair.b]);

  const failures = [
    track?.status === "error" ? track.failure : null,
    lapA?.status === "error" ? lapA.failure : null,
    lapB?.status === "error" && pair.b !== pair.a ? lapB.failure : null,
  ].filter((f): f is LoadFailure => f !== null);

  const retry = () => {
    retrying.current = true;
    setTrack((t) => (t?.status === "error" ? null : t));
    setLaps((p) => {
      const next: Record<string, Loaded<Lap>> = {};
      for (const [k, v] of Object.entries(p)) if (v.status === "ready") next[k] = v;
      return next;
    });
  };

  const setPair = (a: string, b: string) => {
    setPicked({ a, b });
    writePairToUrl(a, b);
  };

  const pickLapB = () => {
    flushSync(() => setControlsOpen(true));
    lapBRef.current?.focus();
  };

  const refA = findLap(session, pair.a);
  const refB = findLap(session, pair.b);
  const codeA = refA?.driver.code ?? pair.a;
  const codeB = refB?.driver.code ?? pair.b;

  const c = result && "c" in result ? result.c : null;
  const trackValue = track?.status === "ready" ? track.value : null;
  const phase = sameLap
    ? "same"
    : failures.length > 0 || (result && "error" in result)
      ? "error"
      : c === null
        ? "loading"
        : "ready";

  // After Try again: the loading line while the files load, then the heading, or the new Try
  // again if the retry failed too.
  useEffect(() => {
    if (!retrying.current) return;
    if (phase === "loading") {
      loadingRef.current?.focus();
      return;
    }
    retrying.current = false;
    if (phase === "error") tryAgainRef.current?.focus();
    else headingRef.current?.focus();
  }, [phase]);

  // Keyboard focus must never land under the sticky readout (WCAG 2.2 2.4.11): its live height
  // feeds scroll-padding-top on the page (app/globals.css).
  const hasSticky = c !== null;
  useEffect(() => {
    const el = stickyRef.current;
    const root = document.documentElement;
    if (!hasSticky || !el) return;
    const ro = new ResizeObserver(() => {
      root.style.setProperty("--sticky-h", `${String(el.offsetHeight)}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--sticky-h");
    };
  }, [hasSticky]);
  const sel = c !== null && selected !== null && selected < c.corners.length ? selected : null;
  const selRow = c !== null && sel !== null ? (c.corners[sel] ?? null) : null;
  const zoom =
    zoomed && selRow && c
      ? { min: Math.max(0, selRow.seg_start_m - 40), max: Math.min(c.L_m, selRow.seg_end_m + 40) }
      : null;

  const selectCorner = (index: number) => {
    if (!c) return;
    const row = c.corners[index];
    if (!row) return;
    setSelected(index);
    setZoomed(true);
    store.set({ mode: "distance", i: indexAtDistance(c, row.s_m) }, "corner");
  };

  return (
    <CursorContext.Provider value={store}>
      <main id="main" className="mx-auto max-w-[1600px] px-gutter">
        <CompareHeader
          session={session}
          choices={choices}
          pair={pair}
          c={c}
          track={trackValue}
          defaultNote={defaultNote}
          controlsOpen={controlsOpen}
          onToggleControls={() => setControlsOpen((o) => !o)}
          onPair={setPair}
          headingRef={headingRef}
          lapBRef={lapBRef}
        />

        {phase === "same" ? (
          <div className="flex flex-col items-start gap-4 py-8">
            <div role="status" className="flex max-w-[70ch] flex-col gap-2">
              <p className="text-panel">Lap A and lap B are the same lap</p>
              <p className="text-body">
                A lap compared with itself has no gaps to show. Pick a different lap for B.
              </p>
            </div>
            <button type="button" className="btn btn-primary" onClick={pickLapB}>
              Pick lap B
            </button>
          </div>
        ) : phase === "error" ? (
          <div className="py-8">
            <ErrorPanel
              title={
                failures.length > 0 ? "Could not load this session" : "Could not compare these laps"
              }
              action={
                <>
                  {failures.length > 0 ? (
                    <button
                      ref={tryAgainRef}
                      type="button"
                      className="btn btn-primary"
                      onClick={retry}
                    >
                      Try again
                    </button>
                  ) : null}
                  <Link href="/sessions" className="btn">
                    Pick another session
                  </Link>
                </>
              }
            >
              <ul className="flex flex-col gap-2">
                {failures.map((f) => (
                  <li key={f.text} className="flex flex-col">
                    <span>{f.text}</span>
                    {f.url ? (
                      <span className="font-mono text-data break-all text-graphite">{f.url}</span>
                    ) : null}
                  </li>
                ))}
                {result && "error" in result ? <li>{result.error}</li> : null}
              </ul>
              {root === "data" && failures.some((f) => f.missing) ? (
                <p className="mt-2">
                  Real sessions live in <code>public/data/</code> on this machine. Run{" "}
                  <code>pnpm export</code> to make them again.
                </p>
              ) : null}
            </ErrorPanel>
          </div>
        ) : c === null ? (
          <CompareSkeleton labelRef={loadingRef} />
        ) : (
          <>
            <div
              ref={stickyRef}
              className="sticky top-[var(--strip-h)] z-10 border-b border-rule bg-paper py-3"
            >
              <CursorReadout c={c} codeA={codeA} codeB={codeB} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr_auto]">
              {(wide ? ["charts", "map", "notes"] : ["map", "notes", "charts"]).map((key) => {
                if (key === "map") {
                  return (
                    <section
                      key="map"
                      aria-labelledby="map-title"
                      className="flex flex-col gap-3 border-b border-rule py-4 md:py-6 lg:col-start-2 lg:row-start-1 lg:border-l lg:pl-6"
                    >
                      <h2 id="map-title" className="text-panel">
                        Track map
                      </h2>
                      {/* Autoplay watches the map and its controls, not the radio log below them,
                          which grows as calls come in. */}
                      <div ref={mapRef} className="flex flex-col gap-3">
                        <TrackMap c={c} codeA={codeA} codeB={codeB} selected={sel} />
                        <GhostReplay c={c} watch={mapRef} replay={replay} onReplay={onReplay} />
                      </div>
                      <TeamRadio
                        key={`${pair.a}|${pair.b}`}
                        c={c}
                        codeA={codeA}
                        codeB={codeB}
                        selected={sel}
                        onCall={selectCorner}
                      />
                    </section>
                  );
                }
                if (key === "notes") {
                  return (
                    <section
                      key="notes"
                      aria-labelledby="notes-title"
                      className="flex flex-col gap-3 border-b border-rule py-4 md:py-6 lg:col-start-2 lg:row-start-2 lg:border-l lg:pl-6 min-[90rem]:row-span-2 min-[90rem]:border-b-0"
                    >
                      <h2 id="notes-title" className="text-panel">
                        Race engineer notes
                      </h2>
                      <EngineerNotes
                        key={`${pair.a}|${pair.b}`}
                        c={c}
                        codeA={codeA}
                        sessionId={session.session_id}
                        pair={{ a: pair.a, b: pair.b }}
                        allowModel={session.origin !== "fastf1"}
                        onCorner={(index) => {
                          selectCorner(index);
                          revealCorner(index);
                        }}
                      />
                    </section>
                  );
                }
                return (
                  <section
                    key="charts"
                    aria-labelledby="charts-title"
                    className="flex min-w-0 flex-col gap-3 border-b border-rule py-4 md:py-6 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:pr-6"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 id="charts-title" className="text-panel">
                        Charts
                      </h2>
                      <div role="group" aria-label="Chart range" className="flex">
                        <button
                          type="button"
                          className="btn rounded-r-none"
                          aria-pressed={zoom === null}
                          onClick={() => setZoomed(false)}
                        >
                          Whole lap
                        </button>
                        <button
                          type="button"
                          className="btn -ml-px rounded-l-none"
                          aria-pressed={zoom !== null}
                          disabled={selRow === null}
                          onClick={() => setZoomed(true)}
                        >
                          {selRow ? `Corner ${selRow.label}` : "Selected corner"}
                        </button>
                      </div>
                    </div>
                    <ChartLegend codeA={codeA} codeB={codeB} />
                    <TelemetryCharts c={c} codeA={codeA} codeB={codeB} zoom={zoom} />
                    {selRow === null ? (
                      <p className="text-meta text-graphite">
                        Pick a corner in the table or the notes to zoom the charts to it.
                      </p>
                    ) : null}
                  </section>
                );
              })}

              <section
                aria-labelledby="table-title"
                className="flex min-w-0 flex-col gap-3 py-4 md:py-6 lg:col-span-2 lg:row-start-3 min-[90rem]:col-span-1 min-[90rem]:col-start-1 min-[90rem]:pr-6"
              >
                <h2 id="table-title" className="text-panel">
                  Corner table
                </h2>
                <CornerTable
                  c={c}
                  codeA={codeA}
                  codeB={codeB}
                  selected={sel}
                  onSelect={selectCorner}
                />
              </section>
            </div>
          </>
        )}
      </main>
    </CursorContext.Provider>
  );
}
