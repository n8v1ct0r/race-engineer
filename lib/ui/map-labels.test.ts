// Corner label placement on made-up tracks: labels never cover each other, the paths the markers
// ride on, or the map edge, and the selected corner is placed first.

import { describe, expect, it } from "vitest";
import { overlaps, placeLabels, type LabelAnchor, type PlacedLabel } from "./map-labels.ts";

/** A long, thin oval like a street circuit at phone width: 358 x 167 px. */
function oval(n: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    xs.push(179 + 150 * Math.cos(t));
    ys.push(83 + 30 * Math.sin(t));
  }
  return { xs, ys };
}

function anchorsOn(path: { xs: number[]; ys: number[] }, count: number): LabelAnchor[] {
  const n = path.xs.length;
  return Array.from({ length: count }, (_, k) => {
    const i = Math.floor((k * n) / count);
    const x = path.xs[i] ?? 0;
    const y = path.ys[i] ?? 0;
    const dx = x - 179;
    const dy = (y - 83) * 25; // outward normal of the oval, from its implicit equation
    const len = Math.hypot(dx, dy) || 1;
    return { index: k, label: `T${String(k + 1)}`, x, y, nx: dx / len, ny: dy / len };
  });
}

function clearOf(label: PlacedLabel, xs: number[], ys: number[], clear: number): boolean {
  const b = label.box;
  return xs.every((x, i) => {
    const y = ys[i] ?? 0;
    return !(x > b.x0 - clear && x < b.x1 + clear && y > b.y0 - clear && y < b.y1 + clear);
  });
}

describe("placeLabels", () => {
  const path = oval(1500);
  const opts = { width: 358, height: 167, obstacles: path, clear: 10, selected: null };

  it("never overlaps another label, a path point or the map edge", () => {
    const placed = placeLabels(anchorsOn(path, 27), opts);
    expect(placed.length).toBeGreaterThan(0);
    for (const [k, p] of placed.entries()) {
      expect(p.box.x0).toBeGreaterThanOrEqual(0);
      expect(p.box.y0).toBeGreaterThanOrEqual(0);
      expect(p.box.x1).toBeLessThanOrEqual(358);
      expect(p.box.y1).toBeLessThanOrEqual(167);
      expect(clearOf(p, path.xs, path.ys, 10)).toBe(true);
      for (const q of placed.slice(k + 1)) expect(overlaps(p.box, q.box)).toBe(false);
    }
  });

  it("leaves a label off when no spot near its corner is clear", () => {
    const placed = placeLabels(anchorsOn(path, 27), opts);
    expect(placed.length).toBeLessThan(27);
    expect(placed.map((p) => p.index)).toEqual(
      [...placed.map((p) => p.index)].sort((a, b) => a - b),
    );
  });

  it("places the selected corner first, so a crowded neighbor cannot take its spot", () => {
    const anchors = anchorsOn(path, 27);
    const unselected = new Set(placeLabels(anchors, opts).map((p) => p.index));
    // A corner crowded out by its neighbors, although it has a clear spot on its own.
    const crowded = anchors.find(
      (a) => !unselected.has(a.index) && placeLabels([a], opts).length === 1,
    );
    expect(crowded).toBeDefined();
    const withSelected = placeLabels(anchors, { ...opts, selected: crowded!.index });
    expect(withSelected.some((p) => p.index === crowded!.index)).toBe(true);
  });

  it("keeps clear of a second path, where the other car's marker rides", () => {
    const inner = { xs: path.xs.map((x) => x), ys: path.ys.map((y) => 83 + (y - 83) * 0.5) };
    const obstacles = { xs: [...path.xs, ...inner.xs], ys: [...path.ys, ...inner.ys] };
    const placed = placeLabels(anchorsOn(path, 12), { ...opts, obstacles });
    for (const p of placed) expect(clearOf(p, inner.xs, inner.ys, 10)).toBe(true);
  });

  it("finds a spot beside a corner that sits at the map edge with the track turning under it", () => {
    // A straight 24 px under the top edge that turns straight down at x = 190: no room above the
    // corner, and the track itself below it, so only a turned direction is clear.
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = 20; x <= 190; x++) {
      xs.push(x);
      ys.push(24);
    }
    for (let y = 25; y <= 110; y++) {
      xs.push(190);
      ys.push(y);
    }
    const corner: LabelAnchor = { index: 0, label: "T1", x: 190, y: 24, nx: 0, ny: -1 };
    const placed = placeLabels([corner], {
      width: 300,
      height: 120,
      obstacles: { xs, ys },
      clear: 10,
      selected: null,
    });
    expect(placed).toHaveLength(1);
    const [p] = placed;
    expect(clearOf(p!, xs, ys, 10)).toBe(true);
    expect(p!.box.y0).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(p!.x - 190, p!.y - 24)).toBeLessThan(50);
  });
});
