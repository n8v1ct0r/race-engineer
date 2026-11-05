import type { Metadata, Viewport } from "next";
import { AppBar } from "@/components/app-bar";
import { HonestyStrip } from "@/components/honesty-strip";
import { fontVariables } from "./fonts";
import "./globals.css";
// uPlot's stylesheet (1,644 bytes) loads with the root layout, not with the charts. When it came
// with the compare pages, every Link to one of them made Next's prefetch preload it on pages that
// never apply it, and Chrome warned about the unused preload 3 s after load. It stays after
// globals.css, as before, so the sheet's .telemetry rules keep their place in the cascade.
import "uplot/dist/uPlot.min.css";

export const metadata: Metadata = {
  title: { default: "AI Race Engineer", template: "%s · AI Race Engineer" },
  description: "Formula 1™ qualifying laps, compared corner by corner.",
};

export const viewport: Viewport = {
  themeColor: "#0d0f13",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">
        <a
          href="#main"
          className="btn btn-primary absolute left-2 top-2 z-50 -translate-y-24 focus:translate-y-0"
        >
          Skip to content
        </a>
        <HonestyStrip hasF1Data={process.env.HAS_F1_DATA === "1"} />
        <AppBar />
        {children}
      </body>
    </html>
  );
}
