"use client";

// SVG track map from the grid XY (plan sections 3 and 5). 25 mini-sectors drawn in the faster
// driver's color, a lighter tint under 25 ms, Graphite for ties, 2 px Paper gaps between them.
// Markers: A is a circle, B a diamond; the legend under the map names them. The map is drawn in
// pixel space, so stroke widths and text sizes are exact at every width. A long, thin track is
// turned to its principal axis and the box height follows its shape, so it fills the width instead
// of a sliver. Corner labels keep clear of both cars' paths, so no label ever covers a marker or
// another label (lib/ui/map-labels.ts); a label with no clear spot near its corner is left off
// (the corner table lists them all).

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Comparison, MiniSector } from "@/lib/analysis/index.ts";
import { useCursor, useCursorStore } from "@/lib/cursor-store.ts";
import { cursorPoint, indexAtDistance } from "@/lib/ui/geometry.ts";
import {
  LABEL_FONT,
  placeLabels,
  type LabelAnchor,
  type PlacedLabel,
} from "@/lib/ui/map-labels.ts";
import config from "@/analysis-config.json";
import { DriverMark } from "./marks";

type Size = { w: number; h: number };

/** A rotation of the track's XY frame: u runs along the chosen axis, v across it. */
type Frame = { cos: number; sin: number; minU: number; minV: number; bu: number; bv: number };

type Projection = {
  /** Track XY to SVG pixels. */
  at: (x: number, y: number) => { x: number; y: number };
  /** Grid points of lap A in SVG pixels, one per 2 m grid index. The track is drawn from these. */
  gx: number[];
  gy: number[];
  /** Grid points of lap B in SVG pixels. Its marker rides on these. */
  bx: number[];
  by: number[];
  cx: number;
  cy: number;
  size: Size;
};

const PAD = 28;
const MIN_H = 160;
/** Turn the track only when that makes it at least this much larger in the box. */
const ROTATE_GAIN = 1.25;

function frameAt(xs: readonly number[], ys: readonly number[], theta: number): Frame {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    const u = x * cos + y * sin;
    const v = -x * sin + y * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { cos, sin, minU, minV, bu: Math.max(1, maxU - minU), bv: Math.max(1, maxV - minV) };
}

/** The principal axis of the points, as an angle in (-90, 90] degrees. */
function principalAngle(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.max(1, xs.length);
  let mx = 0;
  let my = 0;
  for (let i = 0; i < xs.length; i++) {
    mx += xs[i] ?? 0;
    my += ys[i] ?? 0;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = (xs[i] ?? 0) - mx;
    const dy = (ys[i] ?? 0) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * sxy, sxx - syy);
}

/** Scale that fits a frame into a box of width w, with the height that frame asks for. */
function fitScale(f: Frame, w: number, hMax: number): number {
  const h = boxHeight(f, w, hMax);
  return Math.min((w - 2 * PAD) / f.bu, (h - 2 * PAD) / f.bv);
}

/** The box height a frame needs at width w, between MIN_H and hMax. */
function boxHeight(f: Frame, w: number, hMax: number): number {
  const want = ((w - 2 * PAD) * f.bv) / f.bu + 2 * PAD;
  return Math.round(Math.min(hMax, Math.max(MIN_H, want)));
}

/** The tallest box the layout allows at width w. */
function maxHeight(w: number): number {
  return Math.round(Math.min(340, Math.max(220, w * 0.66)));
}

/**
 * The track as drawn: its own XY frame when that fits well, otherwise turned to its principal
 * axis (a long, thin circuit then runs across the box instead of down a sliver of it).
 */
function chooseFrame(c: Comparison, w: number): Frame {
  const xs = c.grid.a.x;
  const ys = c.grid.a.y;
  const plain = frameAt(xs, ys, 0);
  const turned = frameAt(xs, ys, principalAngle(xs, ys));
  const hMax = maxHeight(w);
  return fitScale(turned, w, hMax) > ROTATE_GAIN * fitScale(plain, w, hMax) ? turned : plain;
}

function project(c: Comparison, f: Frame, size: Size): Projection {
  const k = Math.min((size.w - 2 * PAD) / f.bu, (size.h - 2 * PAD) / f.bv);
  const ox = (size.w - f.bu * k) / 2;
  const oy = (size.h - f.bv * k) / 2;
  const at = (x: number, y: number) => {
    const u = x * f.cos + y * f.sin;
    const v = -x * f.sin + y * f.cos;
    // SVG y grows downward; track v grows upward.
    return { x: ox + (u - f.minU) * k, y: size.h - (oy + (v - f.minV) * k) };
  };
  const n = c.grid.s_m.length;
  const gx = new Array<number>(n);
  const gy = new Array<number>(n);
  const bx = new Array<number>(n);
  const by = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const q = at(c.grid.a.x[i] ?? 0, c.grid.a.y[i] ?? 0);
    gx[i] = q.x;
    gy[i] = q.y;
    const r = at(c.grid.b.x[i] ?? 0, c.grid.b.y[i] ?? 0);
    bx[i] = r.x;
    by[i] = r.y;
  }
  return { at, gx, gy, bx, by, cx: size.w / 2, cy: size.h / 2, size };
}

function pathFor(p: Projection, i0: number, i1: number): string {
  let d = "";
  for (let i = i0; i <= i1; i++) {
    const x = String(Math.floor((p.gx[i] ?? 0) * 10 + 0.5) / 10);
    const y = String(Math.floor((p.gy[i] ?? 0) * 10 + 0.5) / 10);
    d += (i === i0 ? "M" : "L") + x + " " + y;
  }
  return d;
}

/** Unit normal at grid index i, pointing away from the map's center. */
function outward(p: Projection, i: number): { nx: number; ny: number } {
  const n = p.gx.length;
  const i0 = Math.max(0, i - 3);
  const i1 = Math.min(n - 1, i + 3);
  const dx = (p.gx[i1] ?? 0) - (p.gx[i0] ?? 0);
  const dy = (p.gy[i1] ?? 0) - (p.gy[i0] ?? 0);
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const x = p.gx[i] ?? 0;
  const y = p.gy[i] ?? 0;
  if ((x - p.cx) * nx + (y - p.cy) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}

/**
 * How far every label box keeps from both cars' paths, in px: the 8 px diamond marker (7 px plus
 * its ring) and 2 px of air. The 10 px track stroke, the 12 px highlight and the 9 px start tick
 * all sit inside it.
 */
const PATH_CLEAR = 10;

/** Corner labels for this projection: the selected corner first, then lap order. */
function cornerLabels(c: Comparison, p: Projection, selected: number | null): PlacedLabel[] {
  const anchors: LabelAnchor[] = c.corners.map((r) => {
    const i = indexAtDistance(c, r.s_m);
    const { nx, ny } = outward(p, i);
    return { index: r.index, label: r.label, x: p.gx[i] ?? 0, y: p.gy[i] ?? 0, nx, ny };
  });
  return placeLabels(anchors, {
    width: p.size.w,
    height: p.size.h,
    obstacles: { xs: [...p.gx, ...p.bx], ys: [...p.gy, ...p.by] },
    clear: PATH_CLEAR,
    selected,
  });
}

function sectorClass(m: MiniSector): string {
  if (m.faster === "A") return "stroke-driver-a";
  if (m.faster === "B") return "stroke-driver-b";
  return "stroke-graphite";
}

type LayerProps = {
  c: Comparison;
  p: Projection;
  selected: number | null;
};

/** Everything that does not move with the cursor. Memoized so markers redraw alone. */
const StaticLayer = memo(function StaticLayer({ c, p, selected }: LayerProps) {
  const sectors = c.mini_sectors.map((m) => {
    const i0 = indexAtDistance(c, m.s_start_m);
    const i1 = indexAtDistance(c, m.s_end_m);
    return { m, d: pathFor(p, i0, i1), i0 };
  });
  const row = selected === null ? null : (c.corners[selected] ?? null);
  const highlight =
    row === null
      ? null
      : pathFor(p, indexAtDistance(c, row.seg_start_m), indexAtDistance(c, row.seg_end_m));
  const labels = cornerLabels(c, p, selected);

  return (
    <g>
      <path
        d={pathFor(p, 0, c.grid.s_m.length - 1)}
        fill="none"
        className="stroke-rule"
        strokeWidth={10}
        strokeLinejoin="round"
      />
      {highlight ? (
        <path
          d={highlight}
          fill="none"
          className="stroke-ink"
          strokeWidth={12}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}
      {sectors.map(({ m, d }) => (
        <path
          key={m.index}
          d={d}
          fill="none"
          className={sectorClass(m)}
          // Under faint_below_ms the sector is drawn thin, in full color: a pale (translucent)
          // stroke fell below the 3:1 non-text contrast bar, a thin one keeps both driver colors
          // at 3.10:1 or better over the Rule underlay.
          strokeWidth={m.faint ? 3 : 6}
          strokeLinejoin="round"
        />
      ))}
      {/* 2 px Paper gaps between mini-sectors. */}
      {sectors.map(({ m, i0 }) => {
        const x = p.gx[i0] ?? 0;
        const y = p.gy[i0] ?? 0;
        const { nx, ny } = outward(p, i0);
        const start = m.index === 0;
        const r = start ? 9 : 6;
        return (
          <line
            key={`gap-${String(m.index)}`}
            x1={x - nx * r}
            y1={y - ny * r}
            x2={x + nx * r}
            y2={y + ny * r}
            className={start ? "stroke-ink" : "stroke-paper"}
            strokeWidth={2}
          />
        );
      })}
      {labels.map(({ index, label, x, y }) => {
        const on = selected === index;
        return (
          <text
            key={index}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={LABEL_FONT}
            fontWeight={on ? 700 : 400}
            className={on ? "fill-ink stroke-paper" : "fill-graphite stroke-paper"}
            strokeWidth={3}
            paintOrder="stroke"
          >
            {label}
          </text>
        );
      })}
    </g>
  );
});

function diamond(x: number, y: number, r: number): string {
  return `${x},${y - r} ${x + r},${y} ${x},${y + r} ${x - r},${y}`;
}

/**
 * The two moving markers, drawn over the labels. Subscribes to the cursor store on its own. No
 * text rides with them: the circle and the diamond are named in the legend under the map, and a
 * moving code would cross the corner labels.
 */
function Markers({ c, p }: { c: Comparison; p: Projection }) {
  const store = useCursorStore();
  const snap = useCursor(store);
  const pt = cursorPoint(c, snap);
  const { x: ax, y: ay } = p.at(pt.a.x, pt.a.y);
  const { x: bx, y: by } = p.at(pt.b.x, pt.b.y);
  return (
    <g data-cursor-mode={pt.mode} data-cursor-idx={pt.i}>
      <polygon points={diamond(bx, by, 7)} className="fill-driver-b stroke-paper" strokeWidth={2} />
      <circle cx={ax} cy={ay} r={5} className="fill-driver-a stroke-paper" strokeWidth={2} />
    </g>
  );
}

type Props = {
  c: Comparison;
  codeA: string;
  codeB: string;
  selected: number | null;
};

export function TrackMap({ c, codeA, codeB, selected }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frame = useMemo(() => (width ? chooseFrame(c, width) : null), [c, width]);
  const size = useMemo(
    (): Size | null =>
      width && frame ? { w: width, h: boxHeight(frame, width, maxHeight(width)) } : null,
    [width, frame],
  );
  const p = useMemo(() => (size && frame ? project(c, frame, size) : null), [c, frame, size]);

  const counts = useMemo(() => {
    let a = 0;
    let b = 0;
    let tie = 0;
    for (const m of c.mini_sectors) {
      if (m.faster === "A") a++;
      else if (m.faster === "B") b++;
      else tie++;
    }
    return { a, b, tie, n: c.mini_sectors.length };
  }, [c]);

  const faint = config.minisectors.faint_below_ms;
  const aria =
    `Track map with ${String(counts.n)} mini-sectors. ${codeA} was faster in ${String(counts.a)} of ${String(counts.n)}, ` +
    `${codeB} in ${String(counts.b)} of ${String(counts.n)}` +
    (counts.tie > 0 ? `, ${String(counts.tie)} level` : "") +
    `. Thin sectors differ by under ${String(faint)} ms. The corner table below lists each corner as text.`;

  return (
    <div className="flex flex-col gap-3">
      <div ref={ref} className="relative w-full" style={{ height: size?.h ?? 260 }}>
        {size && p ? (
          <svg
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${String(size.w)} ${String(size.h)}`}
            role="img"
            aria-label={aria}
            className="block"
          >
            <StaticLayer c={c} p={p} selected={selected} />
            <Markers c={c} p={p} />
          </svg>
        ) : (
          <div className="skeleton h-full w-full" aria-hidden="true" />
        )}
      </div>
      <div className="flex flex-col gap-1 text-meta text-graphite">
        <p>Color shows who was faster in each mini-sector</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <DriverMark slot="a" />
            <span>
              <span className="font-bold text-ink">{codeA}</span>{" "}
              <span className="font-mono text-ink">{counts.a}</span> of {counts.n}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <DriverMark slot="b" />
            <span>
              <span className="font-bold text-ink">{codeB}</span>{" "}
              <span className="font-mono text-ink">{counts.b}</span> of {counts.n}
            </span>
          </span>
          {counts.tie > 0 ? (
            <span>
              Level <span className="font-mono text-ink">{counts.tie}</span>
            </span>
          ) : null}
          <span>Thin: under {faint} ms</span>
        </p>
      </div>
    </div>
  );
}
