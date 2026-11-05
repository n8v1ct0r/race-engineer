// The home page's first minute: it lands in a comparison with the ghost replay already running,
// team radio calls come in as the replay passes each corner, and a click on a call moves the
// charts to that corner. Every call quotes the same delta as its corner table row. The shared
// honesty strip names the kind of data on screen.

import {
  COMPARE_PAGES,
  NO_F1_REASON,
  expect,
  f1Session,
  playButton,
  test,
  waitForCompare,
} from "./support.ts";

const HOME_KIND = f1Session() ? "RECORDED · FastF1" : "SIMULATED · synthetic laps";

test.describe("honesty strip", () => {
  for (const [path, kind] of [
    ["/", HOME_KIND],
    ["/demo", "SIMULATED · synthetic laps"],
    ["/about", HOME_KIND],
  ] as const) {
    test(`${path}: the strip is pinned to the top and says ${kind}`, async ({ page }) => {
      await page.goto(path);
      const strip = page.locator("[data-honesty-strip]");
      await expect(strip).toBeVisible();
      await expect(strip).toContainText(kind);
      await expect(strip.getByRole("link", { name: "NATE VICTOR / SIDEQUEST 04" })).toHaveAttribute(
        "href",
        "https://nate-victor.com",
      );
      const box = await strip.boundingBox();
      expect(box?.y).toBe(0);
      expect(box?.height).toBe(32);
      // The app starts below the strip, never under it.
      const bar = await page.locator("body > header").first().boundingBox();
      expect(bar?.y ?? 0).toBeGreaterThanOrEqual(32);
    });
  }

  test("F1 session page: RECORDED · FastF1", async ({ page }) => {
    const f1 = f1Session();
    test.skip(f1 === null, NO_F1_REASON);
    await page.goto(f1?.path ?? "");
    await expect(page.locator("[data-honesty-strip]")).toContainText("RECORDED · FastF1");
  });
});

test.describe("team radio", () => {
  test.use({ reducedMotion: "no-preference" });

  test("home opens on a running replay; calls come in and a click moves the charts", async ({
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) < 600,
      "On a phone the map sits under the fold, so autoplay waits for a scroll.",
    );
    test.setTimeout(120_000);
    await page.goto("/");
    await waitForCompare(page);
    // No picker first: the replay is already running.
    await expect(playButton(page)).toHaveText("Pause");

    // The first call arrives as car A leaves its corner, within the first minute, as an on-air
    // card over the page and as an entry in the radio log.
    const onAir = page.locator("[data-radio-overlay]");
    await expect(onAir).toBeVisible({ timeout: 60_000 });
    const label = (await onAir.getAttribute("data-radio-overlay")) ?? "";
    const call = page.locator(`[data-radio-call="${label}"]`);
    await expect(call).toHaveCount(1);

    const index = (await call.getAttribute("data-corner-index")) ?? "";
    const delta = ((await call.locator("[data-radio-delta]").textContent()) ?? "").trim();
    expect(delta).toMatch(/^(gains|loses) \d+\.\d{3} s$/);
    // The call quotes the computed corner table, not its own number.
    await expect(page.locator(`#corner-row-${index}`)).toContainText(delta);

    // Clicking the on-air call zooms the charts to its corner and stops the replay.
    await onAir.click();
    await expect(page.getByRole("button", { name: `Corner ${label}` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(call).toHaveAttribute("aria-pressed", "true");
    await expect(onAir).toHaveCount(0);

    // A click on a call in the log does the same.
    const other = page.locator("[data-radio-call]").last();
    const otherLabel = (await other.getAttribute("data-radio-call")) ?? "";
    await other.click();
    await expect(page.getByRole("button", { name: `Corner ${otherLabel}` })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // A person stepped in, so the replay stays stopped.
    await expect(playButton(page)).toHaveText("Play");
  });
});

for (const cp of COMPARE_PAGES) {
  test.describe(cp.name, () => {
    test.skip(cp.path === null, NO_F1_REASON);
    test.use({ reducedMotion: "reduce" });

    test(`${cp.name}: with reduced motion every call shows at once and none animates`, async ({
      page,
    }) => {
      await page.goto(cp.path ?? "");
      await waitForCompare(page);
      const counter = page.locator("[data-team-radio] h3 + span");
      const text = (await counter.textContent()) ?? "";
      const [shown, total] = text.split(" of ").map(Number);
      expect(total).toBeGreaterThan(0);
      expect(shown).toBe(total);
      await expect(page.locator("[data-radio-call]")).toHaveCount(total ?? 0);
      await expect(page.locator(".radio-call.is-new")).toHaveCount(0);
    });
  });
}
