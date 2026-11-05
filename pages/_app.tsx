// The Pages Router exists only for the error pages Next.js builds outside the App Router
// (pages/500.tsx, pages/_error.tsx). Without it, those responses have no app bar and no disclaimer.
// next/font cannot run in _document, so the font variables and the two font stacks are set on a
// wrapper here instead of on <html> as app/layout.tsx does.

import type { AppProps } from "next/app";
import type { CSSProperties } from "react";
import { HonestyStrip } from "../components/honesty-strip";
import { fontVariables } from "../app/fonts";
import "../app/globals.css";

const fonts = {
  "--ui-sans": "var(--font-atkinson-next), ui-sans-serif, system-ui, sans-serif",
  "--ui-mono": "var(--font-atkinson-mono), ui-monospace, monospace",
} as CSSProperties;

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div
      className={`${fontVariables} min-h-dvh bg-paper font-sans text-ink antialiased`}
      style={fonts}
    >
      <HonestyStrip hasF1Data={process.env.HAS_F1_DATA === "1"} />
      <Component {...pageProps} />
    </div>
  );
}
