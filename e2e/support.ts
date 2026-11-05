// Shared helpers for the end-to-end tests and the Phase 4 capture script: the pages under test,
// the console guard every test runs under, readers for the shared cursor, focus readers, and a
// width check. Formula 1 pages are found through public/data/manifest.json at run time; only the
// page URL, the session id and the default lap ids are read from it, and no Formula 1 value is
// ever written into this folder.

import { readFileSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";

/** The line every page carries (CLAUDE.md hard rule 4). */
export const DISCLAIMER = "Unofficial. Not affiliated with Formula 1.";

export const NO_F1_REASON =
  "No public/data/manifest.json on this machine. Formula 1 sessions are exported locally and never committed, so CI tests the synthetic demo only.";

type ManifestSession = {
  session_id: string;
  origin: string;
  season: number | null;
  location_slug: string;
  session_code: string;
  default_pair: { a: string; b: string };
};

function readSessions(rel: string): ManifestSession[] | null {
  let text: string;
  try {
    text = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
  return (JSON.parse(text) as { sessions: ManifestSession[] }).sessions;
}

/** The first exported Formula 1 session, or null when public/data/ is absent (CI, fresh clones). */
export function f1Session(): { path: string; id: string; pair: { a: string; b: string } } | null {
  const s = readSessions("public/data/manifest.json")?.find(
    (x) => x.origin === "fastf1" && x.season !== null,
  );
  if (!s) return null;
  return {
    path: `/f1/${String(s.season)}/${s.location_slug}/${s.session_code.toLowerCase()}`,
    id: s.session_id,
    pair: s.default_pair,
  };
}

/** The synthetic session's id and default pair, from the committed demo manifest. */
export function demoSession(): { id: string; pair: { a: string; b: string } } {
  const s = readSessions("public/demo/manifest.json")?.find((x) => x.origin === "synthetic");
  if (!s) throw new Error("public/demo/manifest.json has no synthetic session");
  return { id: s.session_id, pair: s.default_pair };
}

export type ComparePage = { name: "demo" | "f1"; path: string | null };

/** The compare pages under test: the demo always, one Formula 1 session when exported here. */
export const COMPARE_PAGES: ComparePage[] = [
  { name: "demo", path: "/demo" },
  { name: "f1", path: f1Session()?.path ?? null },
];

export type ConsoleEntry = { type: string; text: string; url: string };

export type ConsoleWatch = {
  /** Every console error, console warning and uncaught page error since the watch began. */
  entries: ConsoleEntry[];
  /** The entries that count against polish item 2 (all of them but the one allowed line). */
  problems: () => ConsoleEntry[];
};

/** What Chrome logs for any response with status 404, the page's own document included. */
const NOT_FOUND_LINE = "Failed to load resource: the server responded with a status of 404";

/**
 * Collects console errors, console warnings and uncaught page errors from now on. A page whose
 * document answers 404 on purpose (the 404 route) makes Chrome log that status as a failed
 * resource. That status is the page's job, so exactly that line, for that document's URL, is
 * not a problem. Every other entry is.
 */
export function watchConsole(page: Page): ConsoleWatch {
  const entries: ConsoleEntry[] = [];
  const notFoundDocs = new Set<string>();
  page.on("response", (res) => {
    const req = res.request();
    if (res.status() === 404 && req.isNavigationRequest() && req.frame() === page.mainFrame()) {
      notFoundDocs.add(res.url());
    }
  });
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      entries.push({ type, text: msg.text(), url: msg.location().url });
    }
  });
  page.on("pageerror", (err) =>
    entries.push({ type: "pageerror", text: err.message, url: page.url() }),
  );
  return {
    entries,
    problems: () =>
      entries.filter(
        (e) =>
          !(e.type === "error" && notFoundDocs.has(e.url) && e.text.startsWith(NOT_FOUND_LINE)),
      ),
  };
}

/**
 * The test function every spec uses. Polish item 2 holds on every route any test visits: a
 * console error, a console warning or an uncaught page error anywhere in a test fails it.
 */
export const test = base.extend<{ consoleWatch: ConsoleWatch }>({
  consoleWatch: [
    async ({ page }, use) => {
      const watch = watchConsole(page);
      await use(watch);
      expect(watch.problems(), "console errors, console warnings and page errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Waits until the compare view shows its 5 charts and the map markers. */
export async function waitForCompare(page: Page): Promise<void> {
  await expect(page.locator(".telemetry .uplot")).toHaveCount(5);
  await expect(page.locator("svg g[data-cursor-mode]")).toHaveCount(1);
}

/** Waits for the web fonts, so widths and canvas text are final. */
export async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * Where every cursor sits: "distance 123" when all 5 charts and the map marker share grid index
 * 123 in distance mode, otherwise a description of the mismatch.
 */
export async function syncedCursor(page: Page): Promise<string> {
  const s = await page.evaluate(() => ({
    charts: [...document.querySelectorAll<HTMLElement>(".telemetry .uplot")].map(
      (el) => el.dataset.cursorIdx ?? "",
    ),
    mapMode: document.querySelector("svg g[data-cursor-mode]")?.getAttribute("data-cursor-mode"),
    map: document.querySelector("svg g[data-cursor-mode]")?.getAttribute("data-cursor-idx"),
  }));
  const all = [...s.charts, s.map ?? ""];
  if (s.charts.length === 5 && all.every((v) => v !== "" && v === all[0])) {
    return `${s.mapMode ?? "?"} ${s.map ?? "?"}`;
  }
  return `unsynced: charts [${s.charts.join(", ")}], map ${s.mapMode ?? "?"} ${s.map ?? "?"}`;
}

/** Moves the mouse over chart k (0 speed, 1 throttle, 2 brake, 3 gear, 4 time gap) at a fraction
 * of its width, waits for every cursor to agree, and returns the shared index. */
export async function hoverChart(page: Page, chart: number, frac: number): Promise<string> {
  const over = page.locator(".telemetry .u-over").nth(chart);
  await over.scrollIntoViewIfNeeded();
  const box = await over.boundingBox();
  if (box === null) throw new Error(`chart ${String(chart)} has no layout box`);
  await over.hover({ position: { x: box.width * frac, y: box.height / 2 } });
  await expect.poll(() => syncedCursor(page)).toMatch(/^distance \d+$/);
  return syncedCursor(page);
}

/** On a phone the pickers sit behind the "Change" button; open them when it shows. */
export async function openControls(page: Page): Promise<void> {
  const change = page.getByRole("button", { name: "Change" });
  if (await change.isVisible()) {
    await change.click();
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  }
}

export function scrubBar(page: Page) {
  return page.getByRole("slider", { name: "Replay position in lap time" });
}

export function playButton(page: Page) {
  return page.getByRole("region", { name: "Track map" }).getByRole("button", {
    name: /^(Play|Pause)$/,
  });
}

/** Scrolls the track map to the middle of the viewport (autoplay needs half of it in view). */
export async function centerMap(page: Page): Promise<void> {
  await page
    .getByRole("region", { name: "Track map" })
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
}

/**
 * Horizontal overflow of the page: the window width, the document's scroll width, how far the
 * page moves when asked to scroll right (0 when it cannot), and up to 5 elements that stick out
 * past the document's own box.
 */
export async function overflow(
  page: Page,
): Promise<{ innerWidth: number; scrollWidth: number; scrolledX: number; wide: string[] }> {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const { scrollX, scrollY } = window;
    window.scrollTo(1_000_000, scrollY);
    const scrolledX = window.scrollX;
    window.scrollTo(scrollX, scrollY);
    const box = document.documentElement.getBoundingClientRect().width;
    const wide =
      scrolledX === 0 && scrollWidth <= innerWidth
        ? []
        : [...document.querySelectorAll("body *")]
            .filter((el) => el.getBoundingClientRect().right > box + 0.5)
            .slice(0, 5)
            .map((el) => {
              const cls = [...el.classList].slice(0, 4).join(".");
              return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`;
            });
    return { innerWidth, scrollWidth, scrolledX, wide };
  });
}

export type FocusStop = {
  /** "body" when nothing has focus; a control kind (swap, charts, play...) or the tag name. */
  kind: string;
  name: string;
  /** True when this element had focus before in this walk (Tab wrapped around). */
  repeat: boolean;
  focusVisible: boolean;
  expanded: string | null;
  /** True when the computed outline (not none, at least 2 px, not transparent) or box-shadow
   * shows focus; null when neither is set. */
  styled: boolean | null;
  style: string;
};

/** What has focus, what kind of control it is, and whether its computed style shows focus. */
export async function focusStop(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) {
      return {
        kind: "body",
        name: "",
        repeat: false,
        focusVisible: false,
        expanded: null,
        styled: null,
        style: "",
      };
    }
    const w = window as unknown as { __e2eFocusSeen?: WeakSet<Element> };
    w.__e2eFocusSeen ??= new WeakSet();
    const repeat = w.__e2eFocusSeen.has(el);
    w.__e2eFocusSeen.add(el);

    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 60);
    let kind = el.tagName.toLowerCase();
    if (el instanceof HTMLSelectElement) {
      kind = `select:${el.labels?.[0]?.textContent?.trim() ?? "no label"}`;
    } else if (el.matches("button[aria-label^='Swap laps']")) kind = "swap";
    else if (el.matches("[role=group][aria-label=Charts]")) kind = "charts";
    else if (el.matches("input[type=range]")) kind = "scrub";
    else if (el.matches("button[data-corner]")) kind = "corner";
    else if (el.matches("a[href^='#corner-row-']")) kind = "note-link";
    else if (el.matches("button[aria-controls=compare-controls]")) kind = "change";
    else if (el.matches("button") && /^(Play|Pause)$/.test(el.textContent?.trim() ?? "")) {
      kind = "play";
    }
    const cs = getComputedStyle(el);
    const clear = cs.outlineColor === "transparent" || /,\s*0\)$/.test(cs.outlineColor);
    const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 && !clear;
    const shadow = cs.boxShadow !== "none";
    return {
      kind,
      name,
      repeat,
      focusVisible: el.matches(":focus-visible"),
      expanded: el.getAttribute("aria-expanded"),
      styled: outline || shadow ? true : null,
      style: `outline ${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}; box-shadow ${cs.boxShadow}`,
    };
  });
}

/** CSS pixels that must change for a focus ring drawn on part of a control to count as visible.
 * A 2 px ring around the scrub thumb changes about 210 of them. */
export const FOCUS_RING_MIN_PIXELS = 100;

/**
 * For a control that draws focus on a part of itself (the range thumb), computed style on the
 * element says nothing. Compare the pixels around it focused and blurred instead, at CSS scale so
 * the count means the same at every device scale factor, and count the pixels that change by 64
 * or more in some channel.
 */
export async function focusRingPixels(page: Page): Promise<number> {
  const handle = await page.evaluateHandle(() => document.activeElement as HTMLElement);
  const box = await handle.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const pad = 6;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: box.width + 2 * pad,
    height: box.height + 2 * pad,
  };
  const focused = await page.screenshot({ clip, scale: "css" });
  await handle.evaluate((el) => el.blur());
  const blurred = await page.screenshot({ clip, scale: "css" });
  await handle.evaluate((el) => el.focus());
  await handle.dispose();
  return page.evaluate(
    async ({ a, b }) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("screenshot did not decode"));
          img.src = `data:image/png;base64,${src}`;
        });
      const pixels = (img: HTMLImageElement) => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("no 2d context");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const [pa, pb] = (await Promise.all([load(a), load(b)])).map(pixels);
      if (!pa || !pb || pa.length !== pb.length) return 0;
      let changed = 0;
      for (let i = 0; i < pa.length; i += 4) {
        let d = 0;
        for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs((pa[i + k] ?? 0) - (pb[i + k] ?? 0)));
        if (d >= 64) changed++;
      }
      return changed;
    },
    { a: focused.toString("base64"), b: blurred.toString("base64") },
  );
}

export type TabLog = { kind: string; name: string; visible: boolean; evidence: string }[];

/**
 * Presses Tab from where focus is until focus leaves the page or wraps to a stop it has seen,
 * and checks each stop for visible focus: :focus-visible matches, and the computed outline or
 * box-shadow shows it, or (for a ring on part of the control) at least FOCUS_RING_MIN_PIXELS
 * change on focus. onStop runs after each check, for controls that open more controls.
 */
export async function tabWalk(
  page: Page,
  onStop: (stop: FocusStop) => Promise<void> = async () => {},
): Promise<{ log: TabLog; trail: string[]; noFocus: string[] }> {
  const log: TabLog = [];
  const trail: string[] = [];
  const noFocus: string[] = [];
  for (let press = 0; press < 250; press++) {
    await page.keyboard.press("Tab");
    const stop = await focusStop(page);
    if (stop.kind === "body" || stop.repeat) break;
    trail.push(stop.kind);

    let visible = stop.focusVisible && stop.styled === true;
    let evidence = stop.style;
    if (stop.focusVisible && stop.styled === null) {
      const changed = await focusRingPixels(page);
      visible = changed >= FOCUS_RING_MIN_PIXELS;
      evidence = `${stop.style}; ${String(changed)} CSS pixels change on focus`;
    }
    log.push({ kind: stop.kind, name: stop.name, visible, evidence });
    if (!visible) {
      noFocus.push(
        `${stop.kind} "${stop.name}" (focus-visible ${String(stop.focusVisible)}, ${evidence})`,
      );
    }
    await onStop(stop);
  }
  return { log, trail, noFocus };
}
