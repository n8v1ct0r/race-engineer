"use client";

// Five uPlot charts on the shared 2 m grid (plan section 4). uPlot's cursor.sync keeps them
// together on hover; the cursor store drives them for scrub, corner links, touch, keyboard and
// the replay. Colors come from CSS variables at draw time. No animation. Each chart is
// role="img"; the corner table is the text alternative. The five sit in one focusable group:
// with focus on it, the arrow keys move the distance cursor (the keyboard crosshair). Each chart's
// box has its height in CSS before uPlot mounts, and uPlot fills that box, so nothing below moves
// when the canvases arrive.

import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from "react";
import uPlot from "uplot";
// uPlot's stylesheet is imported once in app/layout.tsx (see the note there).
import type { Comparison, CornerRow } from "@/lib/analysis/index.ts";
import { useCursorStore, type CursorSnapshot } from "@/lib/cursor-store.ts";
import { clampIndex, cursorPoint } from "@/lib/ui/geometry.ts";
import { readPalette, type Palette } from "@/lib/ui/palette.ts";
import { LINE_DASH, LineKey } from "./marks";

const SYNC_KEY = "race-engineer";

type Role = "a" | "b" | "line" | "none";

type ChartKind = "speed" | "throttle" | "brake" | "gear" | "delta";

type ChartSpec = {
  kind: ChartKind;
  title: string;
  unit: string;
  /**
   * The chart box: phone height while the chart column is under 600 px wide, desktop height from
   * there up (a container query on the group). uPlot takes its size from this box, so these
   * classes are the one source of each chart's height. Written out in full because Tailwind reads
   * class names from the source.
   */
  box: string;
};

const SPECS: ChartSpec[] = [
  { kind: "speed", title: "Speed", unit: "km/h", box: "h-[150px] @min-[600px]:h-[180px]" },
  { kind: "throttle", title: "Throttle", unit: "%", box: "h-[72px] @min-[600px]:h-[88px]" },
  { kind: "brake", title: "Brake", unit: "on or off", box: "h-[56px]" },
  { kind: "gear", title: "Gear", unit: "", box: "h-[64px] @min-[600px]:h-[80px]" },
  // 120 or 148 px of plot, plus the 28 px corner ruler under it.
  { kind: "delta", title: "Time gap", unit: "s", box: "h-[148px] @min-[600px]:h-[176px]" },
];

/** Height of the corner ruler under the time gap chart, in px. */
const RULER_H = 28;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Driver B's hover point: a diamond with a 2 px Paper ring, built with DOM calls. */
function diamondPoint(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "pt-diamond";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("viewBox", "0 0 12 12");
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";
  svg.style.overflow = "visible";
  const poly = document.createElementNS(SVG_NS, "polygon");
  poly.setAttribute("points", "6,-1 13,6 6,13 -1,6");
  poly.style.fill = "var(--color-driver-b)";
  poly.style.stroke = "var(--color-paper)";
  poly.style.strokeWidth = "2";
  svg.appendChild(poly);
  el.appendChild(svg);
  return el;
}

// One palette shared by all charts, refreshed from CSS at the start of every draw.
let palette: Palette = readPalette();

function refreshPalette() {
  palette = readPalette();
}

function seriesColor(role: Role): string {
  if (role === "a") return palette.a;
  if (role === "b") return palette.b;
  return palette.ink;
}

function brakeLane(v: boolean | null, top: boolean): number | null {
  if (v === null) return null;
  if (top) return v ? 1.9 : 1.1;
  return v ? 0.9 : 0.1;
}

type Built = {
  data: uPlot.AlignedData;
  series: uPlot.Series[];
  roles: Role[];
  y: uPlot.Scale;
  yAxis: Partial<uPlot.Axis>;
};

function buildSeries(kind: ChartKind, c: Comparison, codeA: string, codeB: string): Built {
  const g = c.grid;
  const x = g.s_m;
  // uPlot scales line widths by the pixel ratio but passes dash lengths to the canvas as given.
  const line = (role: "a" | "b", label: string, extra: Partial<uPlot.Series> = {}) =>
    ({
      label,
      stroke: () => seriesColor(role),
      width: 2,
      dash: LINE_DASH[role].map((v) => v * uPlot.pxRatio),
      points: { show: false },
      ...extra,
    }) as uPlot.Series;

  switch (kind) {
    case "speed":
      return {
        data: [x, g.a.speed_kph, g.b.speed_kph],
        series: [{}, line("a", codeA), line("b", codeB)],
        roles: ["none", "a", "b"],
        y: {
          range: (_u, min, max) => [
            Math.max(0, Math.floor((min - 10) / 20) * 20),
            Math.ceil((max + 10) / 20) * 20,
          ],
        },
        yAxis: {},
      };
    case "throttle":
      return {
        data: [x, g.a.throttle_pct, g.b.throttle_pct],
        series: [{}, line("a", codeA), line("b", codeB)],
        roles: ["none", "a", "b"],
        y: { range: [-5, 105] },
        yAxis: { splits: () => [0, 50, 100] },
      };
    case "brake": {
      const stepped = uPlot.paths.stepped!({ align: 1 });
      return {
        data: [
          x,
          g.a.brake.map((v) => brakeLane(v, true)),
          g.b.brake.map((v) => brakeLane(v, false)),
        ],
        series: [
          {},
          line("a", codeA, {
            width: 1.5,
            paths: stepped,
            fill: () => palette.aTint,
            fillTo: 1.1,
          }),
          line("b", codeB, {
            width: 1.5,
            paths: stepped,
            fill: () => palette.bTint,
            fillTo: 0.1,
          }),
        ],
        roles: ["none", "a", "b"],
        y: { range: [0, 2] },
        yAxis: {
          splits: () => [0.5, 1.5],
          values: () => [codeB, codeA],
          grid: { show: false },
        },
      };
    }
    case "gear": {
      const stepped = uPlot.paths.stepped!({ align: 1 });
      return {
        data: [x, g.a.gear, g.b.gear],
        series: [{}, line("a", codeA, { paths: stepped }), line("b", codeB, { paths: stepped })],
        roles: ["none", "a", "b"],
        y: { range: (_u, min, max) => [Math.max(0, min - 1), max + 1] },
        yAxis: { incrs: [1, 2, 4] },
      };
    }
    case "delta": {
      const d = g.delta_ms.map((v) => v / 1000);
      return {
        data: [x, d.map((v) => (v > 0 ? v : 0)), d.map((v) => (v < 0 ? v : 0)), d],
        series: [
          {},
          {
            stroke: () => "transparent",
            width: 0,
            fill: () => palette.aTint,
            points: { show: false },
          },
          {
            stroke: () => "transparent",
            width: 0,
            fill: () => palette.bTint,
            points: { show: false },
          },
          {
            label: "Gap",
            stroke: () => palette.ink,
            width: 1.5,
            points: { show: false },
          },
        ],
        roles: ["none", "none", "none", "line"],
        y: {
          range: (_u, min, max) => {
            const m = Math.max(Math.abs(min), Math.abs(max), 0.05) * 1.15;
            return [-m, m];
          },
        },
        yAxis: {},
      };
    }
  }
}

function cornerSplits(rows: readonly CornerRow[]) {
  return (_u: uPlot, _i: number, min: number, max: number) =>
    rows.map((r) => r.s_m).filter((s) => s >= min && s <= max);
}

/** Corner labels on the shared ruler, thinned so none overlap at phone width. */
function cornerValues(rows: readonly CornerRow[]) {
  return (u: uPlot, splits: number[]) => {
    let last = -Infinity;
    return splits.map((s) => {
      const row = rows.find((r) => r.s_m === s);
      const pos = u.valToPos(s, "x");
      if (!row || pos - last < 34) return "";
      last = pos;
      return row.label;
    });
  };
}

function makeOpts(
  spec: ChartSpec,
  built: Built,
  rows: readonly CornerRow[],
  width: number,
  height: number,
  isRuler: boolean,
  codeA: string,
  codeB: string,
  onCursor: (u: uPlot) => void,
): uPlot.Options {
  const fontSans = palette.fontSans;
  const tickFont = `12px ${fontSans}`;
  const grid = { stroke: () => palette.rule, width: 1 };
  const ticks = { stroke: () => palette.rule, width: 1, size: 4 };

  const draw: ((u: uPlot) => void)[] = [];
  if (spec.kind === "delta") {
    // "AAA ahead" above zero, "BBB ahead" below (plan section 5). This hook runs after the series
    // are drawn, so each label sits on a solid Paper box that covers the trace under it: the
    // trace can pass behind a label but never through its letters.
    draw.push((u) => {
      const ctx = u.ctx;
      const r = uPlot.pxRatio;
      ctx.save();
      const zero = u.valToPos(0, "y", true);
      ctx.strokeStyle = palette.graphite;
      ctx.lineWidth = r;
      ctx.beginPath();
      ctx.moveTo(u.bbox.left, Math.round(zero) + 0.5);
      ctx.lineTo(u.bbox.left + u.bbox.width, Math.round(zero) + 0.5);
      ctx.stroke();
      ctx.font = `${String(12 * r)}px ${fontSans}`;
      ctx.textAlign = "left";
      const padX = 4 * r;
      const boxH = 16 * r;
      const x = u.bbox.left + 2 * r;
      // top: y of the box's top edge. The text is centered in the box.
      const label = (text: string, top: number) => {
        const w = ctx.measureText(text).width + 2 * padX;
        ctx.fillStyle = palette.paper;
        ctx.fillRect(x, top, w, boxH);
        ctx.fillStyle = palette.graphite;
        ctx.textBaseline = "middle";
        ctx.fillText(text, x + padX, top + boxH / 2);
      };
      label(`${codeA} ahead`, u.bbox.top + 2 * r);
      label(`${codeB} ahead`, u.bbox.top + u.bbox.height - boxH - 2 * r);
      ctx.restore();
    });
  }

  return {
    width,
    height,
    legend: { show: false },
    padding: [8, 8, isRuler ? 0 : 4, 0],
    cursor: {
      sync: { key: SYNC_KEY, setSeries: false },
      drag: { x: false, y: false, setScale: false },
      y: false,
      focus: { prox: -1 },
      points: {
        show: (_u, si) => {
          const role = built.roles[si] ?? "none";
          if (role === "none") return null as unknown as HTMLElement;
          return role === "b" ? diamondPoint() : document.createElement("div");
        },
        size: (_u, si) => (built.roles[si] === "b" ? 12 : 10),
        width: 2,
        stroke: () => palette.paper,
        fill: (_u, si) => seriesColor(built.roles[si] ?? "line"),
      },
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    scales: { x: { time: false }, y: built.y },
    axes: [
      {
        scale: "x",
        show: true,
        size: isRuler ? RULER_H : 0,
        font: tickFont,
        stroke: () => palette.graphite,
        splits: cornerSplits(rows),
        values: isRuler ? cornerValues(rows) : (_u, splits) => splits.map(() => ""),
        grid,
        ticks: isRuler ? ticks : { show: false },
        gap: 4,
      },
      {
        scale: "y",
        size: 48,
        font: tickFont,
        stroke: () => palette.graphite,
        grid,
        ticks: { show: false },
        gap: 6,
        space: 24,
        ...built.yAxis,
      },
    ],
    series: built.series,
    hooks: {
      drawClear: [refreshPalette],
      draw,
      // data-cursor-idx exposes the crosshair index for tests and debugging.
      setCursor: [onCursor, markIdx],
    },
  };
}

function markIdx(u: uPlot) {
  const idx = u.cursor.idx;
  u.root.dataset.cursorIdx = idx === null || idx === undefined ? "" : String(idx);
}

function summary(kind: ChartKind, c: Comparison, codeA: string, codeB: string): string {
  const tail = " The corner table below lists the same data as text.";
  switch (kind) {
    case "speed":
      return `Speed along the lap in km/h. ${codeA} reaches ${c.lap_a.display.top_speed}, ${codeB} reaches ${c.lap_b.display.top_speed}.${tail}`;
    case "throttle":
      return `Throttle position along the lap, 0 to 100%, for ${codeA} and ${codeB}.${tail}`;
    case "brake":
      return `Brake on or off along the lap. ${codeA} on the top lane, ${codeB} on the bottom lane.${tail}`;
    case "gear":
      return `Gear along the lap for ${codeA} and ${codeB}.${tail}`;
    case "delta":
      return `Time gap along the lap. Above zero ${codeA} is ahead, below zero ${codeB} is ahead. Over the lap, ${codeA} ${c.display.gap}.${tail}`;
  }
}

type Props = {
  c: Comparison;
  codeA: string;
  codeB: string;
  /** x range in m for a corner zoom, or null for the whole lap. */
  zoom: { min: number; max: number } | null;
};

/** Arrow keys step 10 m (5 grid points), Shift+arrow and Page keys 100 m. */
const KEY_STEP = 5;
const KEY_PAGE = 50;

export function TelemetryCharts({ c, codeA, codeB, zoom }: Props) {
  const store = useCursorStore();
  const hintId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const targets = useRef<(HTMLDivElement | null)[]>([]);
  const plots = useRef<uPlot[]>([]);
  const ghosts = useRef<{ a: HTMLDivElement; b: HTMLDivElement }[]>([]);
  const zoomRef = useRef(zoom);

  const noThrottle = useMemo(
    () =>
      c.grid.a.throttle_pct.every((v) => v === null) &&
      c.grid.b.throttle_pct.every((v) => v === null),
    [c],
  );

  // Build the charts for this comparison; rebuild when the pair changes.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    refreshPalette();
    const L = c.L_m;
    let applying = false;
    // True only while a mouse is over one of the plots. uPlot also moves its cursor on resize
    // and redraw; those internal updates must not count as a person touching the cursor.
    let hovering = false;

    const onCursor = (u: uPlot) => {
      if (applying || !hovering) return;
      const idx = u.cursor.idx;
      if (idx === null || idx === undefined) return;
      store.set({ mode: "distance", i: idx }, "pointer");
    };

    const created: uPlot[] = [];
    const ghostEls: { a: HTMLDivElement; b: HTMLDivElement }[] = [];
    const cleanups: (() => void)[] = [];

    SPECS.forEach((spec, k) => {
      const target = targets.current[k];
      if (!target) return;
      const built = buildSeries(spec.kind, c, codeA, codeB);
      const isRuler = spec.kind === "delta";
      const opts = makeOpts(
        spec,
        built,
        c.corners,
        Math.max(200, target.clientWidth),
        Math.max(40, target.clientHeight),
        isRuler,
        codeA,
        codeB,
        onCursor,
      );
      const u = new uPlot(opts, built.data, target);
      created.push(u);

      // Ghost replay lines (time mode): one per car, in its color and line pattern.
      const mk = (background: string) => {
        const el = document.createElement("div");
        el.className = "ghost-line";
        el.style.background = background;
        el.style.display = "none";
        u.over.appendChild(el);
        return el;
      };
      const [on, off] = LINE_DASH.b;
      ghostEls.push({
        a: mk("var(--color-driver-a)"),
        b: mk(
          `repeating-linear-gradient(to bottom, var(--color-driver-b) 0 ${String(on)}px, transparent ${String(on)}px ${String((on ?? 0) + (off ?? 0))}px)`,
        ),
      });

      // Touch: press and drag moves the shared cursor; vertical scroll still works (pan-y).
      const over = u.over;
      const onPointer = (e: PointerEvent) => {
        if (e.pointerType !== "touch") return;
        const i = u.posToIdx(e.offsetX);
        if (Number.isFinite(i)) store.set({ mode: "distance", i }, "touch");
      };
      const onEnter = () => {
        hovering = true;
      };
      // After the pointer leaves, put the crosshair back where the shared cursor is.
      const onLeave = () => {
        hovering = false;
        window.setTimeout(() => apply(store.get(), true), 0);
      };
      over.addEventListener("pointerdown", onPointer);
      over.addEventListener("pointermove", onPointer);
      over.addEventListener("mouseenter", onEnter);
      over.addEventListener("mousemove", onEnter);
      over.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        over.removeEventListener("pointerdown", onPointer);
        over.removeEventListener("pointermove", onPointer);
        over.removeEventListener("mouseenter", onEnter);
        over.removeEventListener("mousemove", onEnter);
        over.removeEventListener("mouseleave", onLeave);
      });
    });

    plots.current = created;
    ghosts.current = ghostEls;

    const setX = (range: { min: number; max: number } | null) => {
      const r = range ?? { min: 0, max: L };
      // batch() commits the new scale now, not in a microtask, so apply() below reads it.
      for (const u of created) u.batch(() => u.setScale("x", r));
    };

    function apply(snap: CursorSnapshot, force = false) {
      if (snap.source === "pointer" && !force) return;
      const p = cursorPoint(c, snap);
      applying = true;
      try {
        created.forEach((u, k) => {
          const gh = ghostEls[k];
          if (p.mode === "distance") {
            const left = u.valToPos(c.grid.s_m[p.i] ?? 0, "x");
            u.setCursor({ left, top: 0 }, false);
            markIdx(u);
            if (gh) {
              gh.a.style.display = "none";
              gh.b.style.display = "none";
            }
          } else {
            u.setCursor({ left: -10, top: -10 }, false);
            markIdx(u);
            if (gh) {
              const w = u.over.clientWidth;
              const la = u.valToPos(p.a.s_m, "x");
              const lb = u.valToPos(p.b.s_m, "x");
              gh.a.style.left = `${String(la)}px`;
              gh.b.style.left = `${String(lb)}px`;
              gh.a.style.display = la >= 0 && la <= w ? "block" : "none";
              gh.b.style.display = lb >= 0 && lb <= w ? "block" : "none";
            }
          }
        });
      } finally {
        applying = false;
      }
    }

    setX(zoomRef.current);
    apply(store.get(), true);
    const unsubscribe = store.subscribe(() => apply(store.get()));

    // The boxes change height when the group crosses 600 px, so both sizes are read back.
    const ro = new ResizeObserver(() => {
      created.forEach((u, k) => {
        const target = targets.current[k];
        if (!target) return;
        const w = Math.max(200, target.clientWidth);
        const h = Math.max(40, target.clientHeight);
        if (u.width !== w || u.height !== h) u.setSize({ width: w, height: h });
      });
      apply(store.get(), true);
    });
    ro.observe(wrap);

    // Canvas text uses the web font once it has loaded; recalc axes then.
    let alive = true;
    void document.fonts?.ready.then(() => {
      if (!alive) return;
      for (const u of created) u.redraw(false, true);
    });

    const onZoom = (e: Event) => {
      setX((e as CustomEvent<{ min: number; max: number } | null>).detail);
      apply(store.get(), true);
    };
    wrap.addEventListener("rezoom", onZoom);

    return () => {
      alive = false;
      wrap.removeEventListener("rezoom", onZoom);
      ro.disconnect();
      unsubscribe();
      for (const fn of cleanups) fn();
      for (const u of created) u.destroy();
      plots.current = [];
      ghosts.current = [];
    };
  }, [c, codeA, codeB, store]);

  // Zoom to the selected corner, or back to the whole lap.
  useEffect(() => {
    zoomRef.current = zoom;
    wrapRef.current?.dispatchEvent(new CustomEvent("rezoom", { detail: zoom }));
  }, [zoom]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = c.grid.s_m.length;
    const i = cursorPoint(c, store.get()).i;
    const big = e.shiftKey ? KEY_PAGE : KEY_STEP;
    const next: Record<string, number> = {
      ArrowRight: i + big,
      ArrowLeft: i - big,
      PageUp: i + KEY_PAGE,
      PageDown: i - KEY_PAGE,
      Home: 0,
      End: n - 1,
    };
    const to = next[e.key];
    if (to === undefined) return;
    e.preventDefault();
    store.set({ mode: "distance", i: clampIndex(c, to) }, "keyboard");
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={wrapRef}
        className="telemetry @container flex flex-col gap-3"
        role="group"
        tabIndex={0}
        aria-label="Charts"
        aria-describedby={hintId}
        onKeyDown={onKeyDown}
      >
        {SPECS.map((spec, k) => (
          <figure key={spec.kind} className="m-0 flex flex-col gap-1">
            <figcaption className="flex items-baseline justify-between gap-3 text-meta text-graphite">
              <span>
                <span className="font-bold text-ink">{spec.title}</span>
                {spec.unit ? <span>, {spec.unit}</span> : null}
              </span>
              {spec.kind === "throttle" && noThrottle ? (
                <span>No throttle data in these laps</span>
              ) : null}
            </figcaption>
            <div
              role="img"
              aria-label={summary(spec.kind, c, codeA, codeB)}
              ref={(el) => {
                targets.current[k] = el;
              }}
              className={`min-w-0 ${spec.box}`}
            />
          </figure>
        ))}
      </div>
      <p id={hintId} className="text-meta text-graphite">
        With the charts focused, the arrow keys move the cursor 10 m, and Shift with an arrow moves
        it 100 m. Home and End jump to the start and the finish.
      </p>
    </div>
  );
}

/** Legend for the charts: line keys with codes. */
export function ChartLegend({ codeA, codeB }: { codeA: string; codeB: string }) {
  return (
    <p className="flex items-center gap-4 text-meta text-graphite">
      <span className="inline-flex items-center gap-1.5">
        <LineKey slot="a" />
        <span className="font-bold text-ink">{codeA}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <LineKey slot="b" />
        <span className="font-bold text-ink">{codeB}</span>
      </span>
    </p>
  );
}
