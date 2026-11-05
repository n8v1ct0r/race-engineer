// Limits: per-IP window, daily spend ledger with reservation and settle, kill switch, cap parsing.

import { describe, expect, it } from "vitest";
import {
  clientIp,
  costMicroUsd,
  dailyCapMicroUsd,
  microToUsd,
  notesEnabled,
  RateLimiter,
  SpendLedger,
  SpentOut,
  utcDay,
  worstCaseCallMicroUsd,
} from "./limits.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);

describe("cost math", () => {
  it("prices Haiku 4.5 tokens at $1 and $5 per million", () => {
    expect(costMicroUsd({ input_tokens: 1500, output_tokens: 350 })).toBe(3250);
    expect(microToUsd(3250)).toBe(0.00325);
  });

  it("worst case uses 1 token per 3 chars plus 1000, and the full max_tokens", () => {
    // 4500 chars -> 1500 + 1000 input tokens; 800 output tokens.
    expect(worstCaseCallMicroUsd(4500, 800)).toBe(2500 + 4000);
    expect(worstCaseCallMicroUsd(4501, 800)).toBe(2501 + 4000);
  });
});

describe("env parsing", () => {
  it("NOTES_ENABLED is on unless it says off", () => {
    for (const v of [undefined, "", "true", "1", "yes", "anything"])
      expect(notesEnabled(v)).toBe(true);
    for (const v of ["false", "FALSE", " 0 ", "off", "no"]) expect(notesEnabled(v)).toBe(false);
  });

  it("NOTES_DAILY_SPEND_CAP_USD defaults to 0.50", () => {
    expect(dailyCapMicroUsd(undefined)).toBe(500_000);
    expect(dailyCapMicroUsd("")).toBe(500_000);
    expect(dailyCapMicroUsd("abc")).toBe(500_000);
    expect(dailyCapMicroUsd("-1")).toBe(500_000);
    expect(dailyCapMicroUsd("0.25")).toBe(250_000);
    expect(dailyCapMicroUsd("0.07")).toBe(70_000);
    expect(dailyCapMicroUsd("0")).toBe(0);
  });

  it("on Vercel, reads the client IP from Vercel's header first", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(
      clientIp(h({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }), true),
    ).toBe("1.1.1.1");
    expect(clientIp(h({ "x-forwarded-for": "2.2.2.2" }), true)).toBe("2.2.2.2");
    expect(clientIp(h({ "x-real-ip": "4.4.4.4" }), true)).toBe("4.4.4.4");
    expect(clientIp(h({}), true)).toBe("unknown");
  });

  it("off Vercel, ignores Vercel's header and takes the hop the proxy appended", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    // A client can send both headers; only the rightmost x-forwarded-for hop came from the proxy.
    expect(
      clientIp(h({ "x-vercel-forwarded-for": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }), false),
    ).toBe("2.2.2.2");
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 3.3.3.3" }), false)).toBe("3.3.3.3");
    expect(clientIp(h({ "x-forwarded-for": " , ", "x-real-ip": "4.4.4.4" }), false)).toBe(
      "4.4.4.4",
    );
    expect(clientIp(h({ "x-vercel-forwarded-for": "1.1.1.1" }), false)).toBe("unknown");
  });
});

describe("RateLimiter", () => {
  it("allows 5 per 10 minutes per IP by default", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 5; i++) expect(rl.take("a", T0 + i)).toBe(true);
    expect(rl.take("a", T0 + 10)).toBe(false);
    expect(rl.take("b", T0 + 10)).toBe(true);
    expect(rl.remaining("a", T0 + 10)).toBe(0);
  });

  it("keeps at most maxKeys keys, dropping the least recently used", () => {
    const rl = new RateLimiter(1, 1000, 3);
    for (const k of ["a", "b", "c", "d"]) expect(rl.take(k, 0)).toBe(true);
    expect(rl.size).toBe(3);
    expect(rl.remaining("a", 0)).toBe(1); // "a" was dropped first
    expect(rl.take("d", 0)).toBe(false);
  });

  it("drops expired keys on a sweep", () => {
    const rl = new RateLimiter(1, 1000);
    for (let i = 0; i < 50; i++) rl.take(`ip-${String(i)}`, 0);
    expect(rl.size).toBe(50);
    rl.take("late", 120_000);
    expect(rl.size).toBe(1);
  });

  it("frees a slot when the oldest hit leaves the window", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("a", 500)).toBe(true);
    expect(rl.take("a", 999)).toBe(false);
    expect(rl.take("a", 1000)).toBe(true); // hit at 0 is out of the window
    expect(rl.take("a", 1001)).toBe(false);
  });
});

describe("SpendLedger", () => {
  it("reserves the worst case, then settles to the real cost", () => {
    const l = new SpendLedger(10_000);
    const r1 = l.reserve(6500, T0);
    expect(r1).not.toBeNull();
    expect(l.reserve(6500, T0)).toBeNull(); // 13,000 would pass the cap
    l.settle(r1!, 3250, T0);
    expect(l.committed(T0)).toBe(3250);
    const r2 = l.reserve(6500, T0);
    expect(r2).not.toBeNull();
    expect(l.committed(T0)).toBe(9750);
    l.release(r2!, T0);
    expect(l.committed(T0)).toBe(3250);
  });

  it("stops at the cap exactly and resets at 00:00 UTC", () => {
    const l = new SpendLedger(6500);
    const r = l.reserve(6500, T0);
    expect(r).not.toBeNull();
    l.settle(r!, 6500, T0);
    expect(l.reserve(1, T0)).toBeNull();
    const nextDay = (utcDay(T0) + 1) * DAY;
    expect(l.reserve(1, nextDay - 1)).toBeNull();
    expect(l.reserve(6500, nextDay)).not.toBeNull();
  });

  it("a zero cap refuses every call", () => {
    expect(new SpendLedger(dailyCapMicroUsd("0")).reserve(1, T0)).toBeNull();
  });

  it("drops a reservation from a past day instead of charging today", () => {
    const l = new SpendLedger(10_000);
    const r = l.reserve(6500, T0);
    l.settle(r!, 6500, T0 + DAY);
    expect(l.committed(T0 + DAY)).toBe(0);
  });

  it("allows 76 worst-case calls a day at the default cap", () => {
    const l = new SpendLedger(dailyCapMicroUsd(undefined));
    let n = 0;
    while (l.reserve(6500, T0) !== null) n++;
    expect(n).toBe(76);
  });
});

describe("SpentOut", () => {
  it("blocks until the next UTC day", () => {
    const s = new SpentOut();
    expect(s.active(T0)).toBe(false);
    s.trip(T0);
    expect(s.active(T0 + 1000)).toBe(true);
    expect(s.active((utcDay(T0) + 1) * DAY)).toBe(false);
  });
});
