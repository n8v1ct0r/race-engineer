// Atkinson Hyperlegible Next for every word, Atkinson Hyperlegible Mono for computed values only
// (plan section 5). Loaded once through next/font/google; no font package.

import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  IBM_Plex_Mono,
} from "next/font/google";

export const sans = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  style: ["normal"],
  variable: "--font-atkinson-next",
  display: "swap",
  // next/font has no metric overrides for this family, so it cannot build an adjusted fallback.
  adjustFontFallback: false,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const mono = Atkinson_Hyperlegible_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal"],
  variable: "--font-atkinson-mono",
  display: "swap",
  // Not preloaded: the 404 and error pages show no computed value, so a preload of this file
  // there (from the root layout, or from a prefetch of any other route) went unused and Chrome
  // warned about it. Pages with mono text fetch it on first layout.
  preload: false,
  adjustFontFallback: false,
  fallback: ["ui-monospace", "monospace"],
});

// IBM Plex Mono for the shared honesty strip only (nate-victor.com shared/STRIP.md).
export const plex = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal"],
  variable: "--font-plex-mono",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

export const fontVariables = `${sans.variable} ${mono.variable} ${plex.variable}`;
