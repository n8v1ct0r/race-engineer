// End-to-end tests for the Phase 3 polish bar (e2e/). They run against the production build on
// port 3106, at 1440 px and 390 px. /demo (synthetic) always runs; the Formula 1 page runs only
// when public/data/manifest.json exists on this machine, so CI tests the demo alone.
// Browsers live in node_modules (PLAYWRIGHT_BROWSERS_PATH=0, set by the pnpm scripts).

import { defineConfig, devices } from "@playwright/test";

const PORT = 3106;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 1 : undefined,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // A 390 x 844 phone: mobile viewport rules, touch and overlay scrollbars, so pages get the
      // full 390 px. Chromium only, like the desktop project.
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: `pnpm build && pnpm start -p ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
    // An empty key wins over .env.local (Next never overrides a variable that is already set), so
    // the notes route answers with code-written notes and no model call ever leaves a test run.
    env: { ANTHROPIC_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
