// Colors for canvas and SVG marks, read from the CSS variables in app/globals.css at draw time,
// so the tokens stay the single source (plan section 5). Browser only.

export type Palette = {
  paper: string;
  ink: string;
  graphite: string;
  rule: string;
  a: string;
  b: string;
  ruleTint: string;
  aTint: string;
  bTint: string;
  fontSans: string;
  fontMono: string;
};

const FALLBACK: Palette = {
  paper: "#0d0f13",
  ink: "#e8ebf0",
  graphite: "#9ba2ad",
  rule: "#2b3038",
  a: "#a88beb",
  b: "#e3a845",
  ruleTint: "#1c2025",
  aTint: "#201e2d",
  bTint: "#2f281b",
  fontSans: "sans-serif",
  fontMono: "monospace",
};

export function readPalette(): Palette {
  if (typeof document === "undefined") return FALLBACK;
  const root = getComputedStyle(document.documentElement);
  const body = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => root.getPropertyValue(name).trim() || fallback;
  return {
    paper: v("--color-paper", FALLBACK.paper),
    ink: v("--color-ink", FALLBACK.ink),
    graphite: v("--color-graphite", FALLBACK.graphite),
    rule: v("--color-rule", FALLBACK.rule),
    a: v("--color-driver-a", FALLBACK.a),
    b: v("--color-driver-b", FALLBACK.b),
    ruleTint: v("--color-rule-tint", FALLBACK.ruleTint),
    aTint: v("--color-a-tint", FALLBACK.aTint),
    bTint: v("--color-b-tint", FALLBACK.bTint),
    fontSans: body.fontFamily || FALLBACK.fontSans,
    fontMono: v("--ui-mono", FALLBACK.fontMono),
  };
}
