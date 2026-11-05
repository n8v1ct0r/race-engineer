// Polish item 3: every control works with a keyboard and shows visible focus. Each walk presses
// Tab from the top of the page to the end and checks every stop it lands on (tabWalk in
// support.ts). On a compare page it must reach the pickers, Swap, the chart group, Play, the scrub
// bar, the corner rows and the note links.

import { writeFileSync } from "node:fs";
import type { TestInfo } from "@playwright/test";
import {
  COMPARE_PAGES,
  NO_F1_REASON,
  expect,
  scrubBar,
  syncedCursor,
  tabWalk,
  test,
  waitForCompare,
  type TabLog,
} from "./support.ts";

/** The controls the walk on a compare page must reach. */
const REQUIRED = [
  "select:Season",
  "select:Event",
  "select:Session",
  "select:Lap A driver",
  "select:Lap A lap",
  "select:Lap B driver",
  "select:Lap B lap",
  "swap",
  "charts",
  "play",
  "scrub",
  "corner",
  "note-link",
];

/** Saves every stop with its focus evidence next to the test's results. */
async function attachLog(info: TestInfo, log: TabLog): Promise<void> {
  const file = info.outputPath("tab-stops.json");
  writeFileSync(file, JSON.stringify(log, null, 2));
  await info.attach("tab-stops.json", { path: file, contentType: "application/json" });
}

for (const cp of COMPARE_PAGES) {
  test.describe(cp.name, () => {
    test.skip(cp.path === null, NO_F1_REASON);

    test.describe("tab order", () => {
      // Nothing moves during the walk, so the focus pixel check compares like with like.
      // Autoplay itself is covered in motion.spec.ts.
      test.use({ reducedMotion: "reduce" });

      test(`${cp.name}: Tab reaches every control and each stop shows visible focus`, async ({
        page,
      }, info) => {
        await page.goto(cp.path ?? "");
        await waitForCompare(page);

        const { log, trail, noFocus } = await tabWalk(page, async (stop) => {
          // Phone: the pickers open from the "Change" button, by keyboard like everything else.
          if (stop.kind === "change" && stop.expanded === "false") {
            await page.keyboard.press("Enter");
            await expect(page.getByRole("button", { name: "Done" })).toBeFocused();
          }
        });
        await attachLog(info, log);
        const missing = REQUIRED.filter((k) => !trail.includes(k));
        expect(missing, `Tab order: ${trail.join(" > ")}`).toEqual([]);
        // Every corner row is a stop, not only the first.
        expect(trail.filter((k) => k === "corner").length).toBe(
          await page.locator("button[data-corner]").filter({ visible: true }).count(),
        );
        expect(noFocus).toEqual([]);
      });
    });

    test(`${cp.name}: arrow keys on the chart group move every cursor together`, async ({
      page,
    }) => {
      await page.goto(cp.path ?? "");
      await waitForCompare(page);
      const charts = page.getByRole("group", { name: "Charts", exact: true });
      await charts.focus();

      // Home is grid index 0; an arrow is 10 m (5 points of the 2 m grid), Shift+arrow 100 m.
      await page.keyboard.press("Home");
      await expect.poll(() => syncedCursor(page)).toBe("distance 0");
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => syncedCursor(page)).toBe("distance 5");
      await page.keyboard.press("Shift+ArrowRight");
      await expect.poll(() => syncedCursor(page)).toBe("distance 55");
      await page.keyboard.press("ArrowLeft");
      await expect.poll(() => syncedCursor(page)).toBe("distance 50");
    });

    test(`${cp.name}: Enter on a corner row selects it`, async ({ page }) => {
      await page.goto(cp.path ?? "");
      await waitForCompare(page);
      const corners = page.locator("button[data-corner]").filter({ visible: true });
      const second = corners.nth(1);
      const label = (await second.textContent())?.trim() ?? "";

      await second.focus();
      await page.keyboard.press("Enter");
      await expect(second).toHaveAttribute("aria-pressed", "true");
      await expect(corners.first()).toHaveAttribute("aria-pressed", "false");
      // The charts zoom to that corner, and every cursor moves to it.
      await expect(
        page.getByRole("button", { name: `Corner ${label}`, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => syncedCursor(page)).toMatch(/^distance \d+$/);
    });

    test(`${cp.name}: Enter on a note link selects its corner and moves focus to it`, async ({
      page,
    }) => {
      await page.goto(cp.path ?? "");
      await waitForCompare(page);
      const link = page.locator("a[href^='#corner-row-']").first();
      const index = ((await link.getAttribute("href")) ?? "").replace("#corner-row-", "");

      await link.focus();
      await page.keyboard.press("Enter");
      const corner = page.locator(`button[data-corner="${index}"]`).filter({ visible: true });
      await expect(corner).toBeFocused();
      await expect(corner).toHaveAttribute("aria-pressed", "true");
    });

    test(`${cp.name}: the scrub bar moves with the keyboard`, async ({ page }) => {
      await page.goto(cp.path ?? "");
      await waitForCompare(page);
      const scrub = scrubBar(page);
      await scrub.focus();
      await page.keyboard.press("Home");
      await expect(scrub).toHaveValue("0");
      await page.keyboard.press("ArrowRight");
      await expect(scrub).toHaveValue("100");
      await page.keyboard.press("PageUp");
      await expect(scrub).toHaveValue("1100");
    });
  });
}

for (const r of [
  { label: "home", path: "/", status: 200 },
  { label: "sessions", path: "/sessions", status: 200 },
  { label: "about", path: "/about", status: 200 },
  { label: "404", path: "/no-such-page", status: 404 },
]) {
  test(`${r.label}: every Tab stop shows visible focus`, async ({ page }, info) => {
    const res = await page.goto(r.path);
    expect(res?.status()).toBe(r.status);
    const { log, trail, noFocus } = await tabWalk(page);
    await attachLog(info, log);
    // At least the skip link, the home link and About.
    expect(trail.length, `Tab order: ${trail.join(" > ")}`).toBeGreaterThanOrEqual(3);
    expect(noFocus).toEqual([]);
  });
}

test("sessions: Enter on Compare laps opens the compare page", async ({ page }) => {
  await page.goto("/sessions");
  const button = page.getByRole("button", { name: "Compare laps" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/(demo|f1\/)/);
  await waitForCompare(page);
});
