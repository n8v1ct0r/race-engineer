// Corner label placement for the track map. Pure and browser-safe, so it is unit tested.
//
// A label may never cover another label, the track, either car's path or the start line. The two
// markers ride on those paths, so a label clear of the paths is clear of the markers at every
// moment of the replay, and the labels never have to move. Each label is tried a short way out
// from its corner along the track normal, then a short way in, sliding a little along the track at
// each step. A corner at the map edge or between close neighbors then tries the same distances
// turned toward the track (40, 140 and 90 degrees each way), out to 22 px further. A label with no
// clear spot near its corner is left off (the corner table and the chart ruler list every
// corner). The selected corner goes first and may look a little further.

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** One corner to label: its text, its point on the track and the unit normal pointing outward. */
export type LabelAnchor = {
  index: number;
  label: string;
  x: number;
  y: number;
  nx: number;
  ny: number;
};

export type PlacedLabel = { index: number; label: string; x: number; y: number; box: Box };

export type PlaceOptions = {
  width: number;
  height: number;
  /** Points every label box keeps `clear` px away from, on both axes. */
  obstacles: { xs: readonly number[]; ys: readonly number[] };
  clear: number;
  selected: number | null;
};

/** Corner labels are 12 px Atkinson Hyperlegible Next. */
export const LABEL_FONT = 12;
/** Upper bound of one character's advance at 12 px, in px. */
const CHAR_W = 7.5;
/** Paper halo (3 px stroke) plus air between neighbors, per side, in px. */
const LABEL_MARGIN = 3;

/** Steps along the normal past the first clear distance, in px. */
const STEPS = [0, 4, 8, 14];
const STEPS_SELECTED = [0, 4, 8, 14, 22, 32];
/** Slides along the track at each step, in px. */
const SLIDES = [0, 8, -8, 16, -16];
const SLIDES_SELECTED = [0, 8, -8, 16, -16, 24, -24];

/** Fallback directions, in degrees turned from the outward normal. */
const TURNS = [40, -40, 140, -140, 90, -90];
/** Steps past the first clear distance for the fallback, in px. */
const FALLBACK_STEPS = [0, 4, 8, 14, 22];

const CELL = 16;

/** Half width and half height of a label's box. */
export function labelHalf(text: string): { hw: number; hh: number } {
  return { hw: (text.length * CHAR_W) / 2 + LABEL_MARGIN, hh: LABEL_FONT / 2 + LABEL_MARGIN };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

/** Obstacle points bucketed in 16 px cells, so a box test reads only the cells it touches. */
function bucket(xs: readonly number[], ys: readonly number[]) {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${String(Math.floor(x / CELL))},${String(Math.floor(y / CELL))}`;
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  }
  /** True when any obstacle point lies inside the box grown by `pad` on every side. */
  return (b: Box, pad: number): boolean => {
    const x0 = b.x0 - pad;
    const y0 = b.y0 - pad;
    const x1 = b.x1 + pad;
    const y1 = b.y1 + pad;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const list = cells.get(`${String(cx)},${String(cy)}`);
        if (!list) continue;
        for (const i of list) {
          const x = xs[i] ?? 0;
          const y = ys[i] ?? 0;
          if (x > x0 && x < x1 && y > y0 && y < y1) return true;
        }
      }
    }
    return false;
  };
}

/** Labels that fit, sorted by corner index. */
export function placeLabels(anchors: readonly LabelAnchor[], o: PlaceOptions): PlacedLabel[] {
  const hits = bucket(o.obstacles.xs, o.obstacles.ys);
  const order = [...anchors].sort(
    (p, q) => Number(q.index === o.selected) - Number(p.index === o.selected) || p.index - q.index,
  );
  const placed: PlacedLabel[] = [];
  for (const a of order) {
    const isSelected = a.index === o.selected;
    const steps = isSelected ? STEPS_SELECTED : STEPS;
    const slides = isSelected ? SLIDES_SELECTED : SLIDES;
    const { hw, hh } = labelHalf(a.label);
    // The distance along the normal at which the box first clears the anchor point.
    const base = Math.abs(a.nx) * hw + Math.abs(a.ny) * hh + o.clear;
    const offsets = [...steps.map((k) => base + k), ...steps.map((k) => -(base + k))];
    // Tangent: along the track at this corner.
    const tx = a.ny;
    const ty = -a.nx;
    // Places the label at (x, y) when that spot is clear, and says whether it did.
    const tryPlace = (x: number, y: number): boolean => {
      const box = { x0: x - hw, y0: y - hh, x1: x + hw, y1: y + hh };
      if (box.x0 < 0 || box.y0 < 0 || box.x1 > o.width || box.y1 > o.height) return false;
      if (placed.some((q) => overlaps(q.box, box))) return false;
      if (hits(box, o.clear)) return false;
      placed.push({ index: a.index, label: a.label, x, y, box });
      return true;
    };
    let done = false;
    search: for (const d of offsets) {
      for (const t of slides) {
        if (tryPlace(a.x + a.nx * d + tx * t, a.y + a.ny * d + ty * t)) {
          done = true;
          break search;
        }
      }
    }
    if (done) continue;
    // Fallback, for a corner at the map edge or between neighbors: the same distances in other
    // directions, turned from the normal toward the track.
    fallback: for (const k of FALLBACK_STEPS) {
      for (const deg of TURNS) {
        const rad = (deg * Math.PI) / 180;
        const ux = a.nx * Math.cos(rad) + tx * Math.sin(rad);
        const uy = a.ny * Math.cos(rad) + ty * Math.sin(rad);
        const d = Math.abs(ux) * hw + Math.abs(uy) * hh + o.clear + k;
        if (tryPlace(a.x + ux * d, a.y + uy * d)) break fallback;
      }
    }
  }
  return placed.sort((p, q) => p.index - q.index);
}
