// Polish item 5: every page works at 1440 px and 390 px with no horizontal scroll and no "best on
// desktop" fallback. CLAUDE.md hard rule 4: the disclaimer line shows on every page, 404 included.

import {
  COMPARE_PAGES,
  DISCLAIMER,
  NO_F1_REASON,
  expect,
  fontsReady,
  openControls,
  overflow,
  test,
  waitForCompare,
} from "./support.ts";

type Route = { label: string; path: string | null; compare: boolean; status: number };

const ROUTES: Route[] = [
  // Home lands in a comparison (the featured session, or the demo when no session is exported).
  { label: "home", path: "/", compare: true, status: 200 },
  { label: "sessions", path: "/sessions", compare: false, status: 200 },
  ...COMPARE_PAGES.map((cp) => ({ label: cp.name, path: cp.path, compare: true, status: 200 })),
  { label: "about", path: "/about", compare: false, status: 200 },
  { label: "404", path: "/no-such-page", compare: false, status: 404 },
];

for (const r of ROUTES) {
  test.describe(r.label, () => {
    test.skip(r.path === null, NO_F1_REASON);

    test(`${r.label}: no horizontal scroll and no desktop-only fallback`, async ({
      page,
    }, info) => {
      const res = await page.goto(r.path ?? "");
      expect(res?.status()).toBe(r.status);
      if (r.compare) await waitForCompare(page);
      await fontsReady(page);

      // The window is the project's width, the document is no wider than it, and the page
      // cannot scroll sideways. The document may be narrower by the reserved scrollbar gutter
      // (scrollbar-gutter: stable): this Chromium reserves 15 px of it at 1440 px, seen
      // 2026-11-05 on the unchanged Phase 3 build too.
      const o = await overflow(page);
      const too = `too wide: ${o.wide.join(", ")}`;
      expect(o.innerWidth).toBe(page.viewportSize()?.width);
      expect(o.scrollWidth, too).toBeLessThanOrEqual(o.innerWidth);
      expect(o.scrolledX, too).toBe(0);
      await expect(page.getByText(/best (viewed )?on (a )?(desktop|larger screen)/i)).toHaveCount(
        0,
      );
      const shot = info.outputPath(`${r.label}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      await info.attach(`${r.label}.png`, { path: shot, contentType: "image/png" });

      // Phone: the pickers open under the "Change" button; the open panel must fit too.
      if (r.compare) {
        await openControls(page);
        const open = await overflow(page);
        const openToo = `pickers open, too wide: ${open.wide.join(", ")}`;
        expect(open.scrollWidth, openToo).toBeLessThanOrEqual(open.innerWidth);
        expect(open.scrolledX, openToo).toBe(0);
      }
    });

    // Phase 3 verifier finding: the page fit at load, but once the cursor entered distance mode
    // the sticky readout's gap value ("HAM ahead 0.188 s") outgrew its column on phones and the
    // page scrolled sideways. So sweep the cursor across the lap and check at every stop.
    if (r.compare) {
      test(`${r.label}: the readout fits while the cursor sweeps the lap`, async ({ page }) => {
        const widths =
          (page.viewportSize()?.width ?? 0) < 600 ? [390, 375] : [page.viewportSize()?.width ?? 0];
        const res = await page.goto(r.path ?? "");
        expect(res?.status()).toBe(r.status);
        await waitForCompare(page);
        await fontsReady(page);
        const charts = page.getByRole("group", { name: "Charts", exact: true });
        const gapValue = page
          .getByText("Gap here", { exact: true })
          .locator("xpath=following-sibling::span[1]");
        let sawAhead = false;
        for (const w of widths) {
          await page.setViewportSize({ width: w, height: page.viewportSize()?.height ?? 844 });
          await charts.focus();
          await page.keyboard.press("Home");
          for (let step = 0; step <= 24; step += 1) {
            if (step > 0) {
              for (let k = 0; k < 4; k += 1) await page.keyboard.press("Shift+ArrowRight");
            }
            const text = (await gapValue.textContent()) ?? "";
            if (/ahead/.test(text)) sawAhead = true;
            const o = await overflow(page);
            const where = `width ${String(w)}, step ${String(step)}, gap "${text}", too wide: ${o.wide.join(", ")}`;
            expect(o.scrollWidth, where).toBeLessThanOrEqual(o.innerWidth);
            expect(o.scrolledX, where).toBe(0);
            const clip = await gapValue.evaluate((el) => {
              const box = el.getBoundingClientRect();
              return { right: box.right, clipped: el.scrollWidth > el.clientWidth + 0.5 };
            });
            expect(clip.clipped, where).toBe(false);
            expect(clip.right, where).toBeLessThanOrEqual(w + 0.5);
          }
        }
        // The sweep must have shown a real gap value, not only "Level".
        expect(sawAhead).toBe(true);
      });
    }

    test(`${r.label}: the disclaimer line is visible`, async ({ page }) => {
      const res = await page.goto(r.path ?? "");
      expect(res?.status()).toBe(r.status);
      await expect(
        page.getByText(DISCLAIMER, { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
    });
  });
}
