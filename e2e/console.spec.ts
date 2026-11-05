// Polish item 2: the main flows run with 0 console errors and 0 console warnings (page errors
// count too). Every route is visited and the compare flows are driven the way a person would.
// The consoleWatch fixture (support.ts) runs in every test of every spec; these tests drive the
// flows on purpose and assert the log at the end.

import type { Page } from "@playwright/test";
import {
  COMPARE_PAGES,
  NO_F1_REASON,
  expect,
  f1Session,
  hoverChart,
  openControls,
  playButton,
  scrubBar,
  test,
  waitForCompare,
} from "./support.ts";

/** Hover, keyboard cursor, corner pick, replay, scrub, lap change, swap, and notes on the demo. */
async function driveCompare(page: Page, writeNotes: boolean): Promise<void> {
  await hoverChart(page, 0, 0.4);

  const charts = page.getByRole("group", { name: "Charts", exact: true });
  await charts.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");

  const corner = page.locator("button[data-corner]").filter({ visible: true }).first();
  await corner.focus();
  await page.keyboard.press("Enter");
  await expect(corner).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Whole lap" }).click();

  const play = playButton(page);
  await play.scrollIntoViewIfNeeded();
  await play.click();
  await expect(play).toHaveText("Pause");
  await play.click();
  await expect(play).toHaveText("Play");
  await scrubBar(page).focus();
  await page.keyboard.press("PageUp");

  if (writeNotes) {
    await page.getByRole("button", { name: "Write notes" }).click();
    await expect(page.getByText("This server has no model key", { exact: false })).toBeVisible();
  }

  await openControls(page);
  const driverB = page.getByLabel("Lap B driver");
  const codes = await driverB.locator("option").allTextContents();
  const current = [await page.getByLabel("Lap A driver").inputValue(), await driverB.inputValue()];
  const other = codes.find((code) => !current.includes(code));
  if (other === undefined) throw new Error("the session needs a third driver for this flow");
  await driverB.selectOption(other);
  await expect(page).toHaveURL(new RegExp(`b=${other}-`));
  await waitForCompare(page);

  await page.getByRole("button", { name: /^Swap laps/ }).click();
  await expect(page).toHaveURL(new RegExp(`a=${other}-`));
  await waitForCompare(page);
  await hoverChart(page, 4, 0.6);
}

test("sessions and the picker to a compare page log 0 errors and 0 warnings", async ({
  page,
  consoleWatch,
}) => {
  await page.goto("/sessions");
  await page.getByRole("button", { name: "Compare laps" }).click();
  await expect(page).toHaveURL(/\/(demo|f1\/)/);
  await waitForCompare(page);
  await page.waitForLoadState("networkidle");
  expect(consoleWatch.entries).toEqual([]);
});

test("about page logs 0 errors and 0 warnings", async ({ page, consoleWatch }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(consoleWatch.entries).toEqual([]);
});

for (const cp of COMPARE_PAGES) {
  test.describe(cp.name, () => {
    test.skip(cp.path === null, NO_F1_REASON);

    test(`${cp.name}: main flows log 0 errors and 0 warnings`, async ({ page, consoleWatch }) => {
      await page.goto(cp.path ?? "");
      await waitForCompare(page);
      await driveCompare(page, cp.name === "demo");
      await page.waitForLoadState("networkidle");
      expect(consoleWatch.entries).toEqual([]);
    });
  });
}

test("404 page logs nothing but its own 404 status", async ({ page, consoleWatch }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  // Chrome logs the document's own 404 as a failed resource. That status is the page's job, so
  // at most that one line is allowed, for this URL only (watchConsole in support.ts).
  expect(consoleWatch.entries.length).toBeLessThanOrEqual(1);
  expect(consoleWatch.problems()).toEqual([]);
});

// Chrome reports a preload the page never used about 3 s after the load event, and every test
// above ends sooner than that. Each of these loads one route in a fresh context and stays 4 s
// past the load event, so the console guard sees that warning too.
const DWELL_MS = 4_000;
const DWELL_ROUTES: { name: string; path: string | null }[] = [
  { name: "home", path: "/" },
  { name: "sessions", path: "/sessions" },
  { name: "demo", path: "/demo" },
  { name: "about", path: "/about" },
  { name: "f1", path: f1Session()?.path ?? null },
  { name: "404", path: "/no-such-page" },
];

for (const route of DWELL_ROUTES) {
  test(`${route.name}: nothing logged ${String(DWELL_MS / 1000)} s after load`, async ({
    page,
    consoleWatch,
  }) => {
    test.skip(route.path === null, NO_F1_REASON);
    await page.goto(route.path ?? "", { waitUntil: "load" });
    await page.waitForTimeout(DWELL_MS);
    expect(consoleWatch.problems()).toEqual([]);
  });
}
