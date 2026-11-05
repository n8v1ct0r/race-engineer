// The brief's hover sync: a point hovered on one chart puts all 5 chart crosshairs and the track
// map marker on the same 2 m grid index. uPlot writes data-cursor-idx on each chart root and the
// map marker group carries its own, so the test reads the index each one drew.

import {
  COMPARE_PAGES,
  NO_F1_REASON,
  expect,
  hoverChart,
  syncedCursor,
  test,
  waitForCompare,
} from "./support.ts";

/** "distance 123" to 123. */
function index(state: string): number {
  return Number(state.replace("distance ", ""));
}

for (const cp of COMPARE_PAGES) {
  test.describe(cp.name, () => {
    test.skip(cp.path === null, NO_F1_REASON);

    test(`${cp.name}: hovering one chart moves every chart cursor and the map marker together`, async ({
      page,
    }) => {
      await page.goto(cp.path ?? "");
      await waitForCompare(page);
      const before = await syncedCursor(page);

      // The 5 charts share one x scale and one plot width, so the same fraction of the width is
      // the same grid index on every chart, and a point further right is a larger index.
      const onSpeed = await hoverChart(page, 0, 0.3);
      expect(onSpeed).not.toBe(before);
      const onGap = await hoverChart(page, 4, 0.7);
      expect(index(onGap)).toBeGreaterThan(index(onSpeed));
      const onThrottle = await hoverChart(page, 1, 0.3);
      expect(Math.abs(index(onThrottle) - index(onSpeed))).toBeLessThanOrEqual(1);
    });
  });
}
