// Polish item 6: prefers-reduced-motion stops the motion that is not essential. The ghost replay
// is the only motion on the page. With reduced motion it must not autoplay, and Play must still
// run it, because the person asked for it. Without reduced motion it autoplays once the map is
// in view.

import {
  COMPARE_PAGES,
  NO_F1_REASON,
  centerMap,
  expect,
  playButton,
  scrubBar,
  test,
  waitForCompare,
} from "./support.ts";

for (const cp of COMPARE_PAGES) {
  test.describe(cp.name, () => {
    test.skip(cp.path === null, NO_F1_REASON);

    test.describe("reduced motion", () => {
      test.use({ reducedMotion: "reduce" });

      test(`${cp.name}: nothing moves until Play is pressed, then the replay runs`, async ({
        page,
      }) => {
        await page.goto(cp.path ?? "");
        await waitForCompare(page);
        await centerMap(page);
        const scrub = scrubBar(page);
        const play = playButton(page);

        // 9 samples over 2 s: the replay position must not change.
        const samples: string[] = [];
        for (let k = 0; k < 9; k++) {
          samples.push(await scrub.inputValue());
          await page.waitForTimeout(250);
        }
        expect(new Set(samples).size, `scrub values over 2 s: ${samples.join(", ")}`).toBe(1);
        await expect(play).toHaveText("Play");

        // No CSS animation or transition is running either.
        const running = await page.evaluate(
          () => document.getAnimations().filter((a) => a.playState === "running").length,
        );
        expect(running).toBe(0);

        const start = Number(samples[0]);
        await play.click();
        await expect(play).toHaveText("Pause");
        await expect.poll(async () => Number(await scrub.inputValue())).toBeGreaterThan(start);
      });
    });

    test.describe("no motion preference", () => {
      test.use({ reducedMotion: "no-preference" });

      test(`${cp.name}: the replay autoplays with the map in view`, async ({ page }) => {
        await page.goto(cp.path ?? "");
        await waitForCompare(page);
        await centerMap(page);
        const scrub = scrubBar(page);
        await expect(playButton(page)).toHaveText("Pause");
        const start = Number(await scrub.inputValue());
        await expect.poll(async () => Number(await scrub.inputValue())).toBeGreaterThan(start);
      });
    });
  });
}
