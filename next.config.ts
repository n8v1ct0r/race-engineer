import { existsSync } from "node:fs";
import type { NextConfig } from "next";

// Exported Formula 1 sessions exist only on machines that ran `pnpm export` (and in the one
// deployment that ships a single session). The honesty strip reads this to pick its label.
const hasF1Data = existsSync("public/data/manifest.json");

const nextConfig: NextConfig = {
  // Stop `next dev` from writing its own AGENTS.md and CLAUDE.md into the repo.
  agentRules: false,
  env: { HAS_F1_DATA: hasF1Data ? "1" : "" },
  // The notes route rebuilds insights from the synthetic lap files on disk. From public/data it
  // reads only the manifest: Formula 1 sessions are refused before any lap file is read (D1), so
  // their lap and track files stay out of the function bundle. The tracer finds public/ through
  // the route's readFile call, so the exclude is what keeps them out, not the include alone.
  outputFileTracingIncludes: {
    "/api/notes": ["./public/demo/**/*.json", "./public/data/manifest.json"],
  },
  outputFileTracingExcludes: {
    "/api/notes": ["./public/data/*/laps/**", "./public/data/*/track.json"],
  },
  experimental: {
    // The whole stylesheet is about 8 KB, so production pages carry it inline instead of as 2
    // render-blocking requests (Lighthouse estimated 302 ms and 152 ms on mobile). Production only.
    inlineCss: true,
  },
};

export default nextConfig;
