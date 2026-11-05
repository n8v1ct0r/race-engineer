// Notes (docs/contracts.md section 6). The demo's "Write notes" sends lap ids only and, with no
// ANTHROPIC_API_KEY on the server (playwright.config.ts sets it empty), gets code-written notes
// and the no_key reason. Formula 1 pages never offer the button and never call the route
// (decision D1); the route itself refuses a Formula 1 session.

import { NO_F1_REASON, demoSession, expect, f1Session, test, waitForCompare } from "./support.ts";

type NotesBody = {
  notes: { finding_id: string; text: string; source: string }[];
  cached: boolean;
  template_reason: string | null;
};

test("demo: Write notes returns code-written notes with the no-key reason", async ({ page }) => {
  const demo = demoSession();
  await page.goto("/demo");
  await waitForCompare(page);

  const button = page.getByRole("button", { name: "Write notes" });
  const [request, response] = await Promise.all([
    page.waitForRequest("**/api/notes"),
    page.waitForResponse("**/api/notes"),
    button.click(),
  ]);
  expect(request.method()).toBe("POST");
  expect(request.postDataJSON()).toEqual({ session_id: demo.id, a: demo.pair.a, b: demo.pair.b });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as NotesBody;
  expect(body.template_reason).toBe("no_key");
  expect(body.notes.length).toBeGreaterThan(0);
  expect(body.notes.filter((n) => n.source !== "template")).toEqual([]);

  await expect(
    page.getByText("This server has no model key, so code wrote these notes."),
  ).toBeVisible();
  const findings = await page.locator("a[href^='#corner-row-']").count();
  await expect(page.getByText("Written by code", { exact: true })).toHaveCount(findings);
  await expect(page.getByText("Written by Claude from these numbers")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test.describe("f1", () => {
  const f1 = f1Session();
  test.skip(f1 === null, NO_F1_REASON);

  test("f1: no Write notes button and no call to the notes route", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.startsWith("/api/notes")) calls.push(req.method());
    });
    await page.goto(f1?.path ?? "");
    await waitForCompare(page);

    await expect(page.getByRole("button", { name: "Write notes" })).toHaveCount(0);
    await expect(
      page.getByText("Claude does not write notes for Formula 1 laps.", { exact: false }),
    ).toBeVisible();
    await page.locator("a[href^='#corner-row-']").first().click();
    await page.waitForLoadState("networkidle");
    expect(calls).toEqual([]);
  });

  test("f1: the notes route refuses a Formula 1 session with 403", async ({ request }) => {
    const res = await request.post("/api/notes", {
      data: { session_id: f1?.id, a: f1?.pair.a, b: f1?.pair.b },
    });
    expect(res.status()).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("model_not_allowed");
  });
});
