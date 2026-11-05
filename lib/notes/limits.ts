// Spend and abuse limits for the notes route. Server only. All state is per instance (docs/
// phase-1-plan.md section 6): with N live instances daily spend can reach N x the cap. The hard
// ceiling is the Anthropic workspace monthly spend limit, which Nate sets in the Console.
// Money is integer micro-dollars (1e-6 USD) so the ledger never drifts.

import "./server-only.ts";
import type { Usage } from "./client.ts";

/** claude-haiku-4-5 list price: $1 per MTok input, $5 per MTok output = 1 and 5 micro-USD a token. */
export const INPUT_MICRO_USD_PER_TOKEN = 1;
export const OUTPUT_MICRO_USD_PER_TOKEN = 5;

export const DEFAULT_DAILY_CAP_USD = 0.5;
export const IP_LIMIT = 5;
export const IP_WINDOW_MS = 10 * 60 * 1000;

export function costMicroUsd(u: Usage): number {
  return u.input_tokens * INPUT_MICRO_USD_PER_TOKEN + u.output_tokens * OUTPUT_MICRO_USD_PER_TOKEN;
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}

/**
 * Worst case for one call before it is made: input estimated at 1 token per 3 characters plus
 * 1000 tokens for the structured output system prompt Anthropic adds (its size is not published),
 * and output at the max_tokens cap.
 */
export function worstCaseCallMicroUsd(inputChars: number, maxTokens: number): number {
  const inputTokens = Math.ceil(inputChars / 3) + 1000;
  return inputTokens * INPUT_MICRO_USD_PER_TOKEN + maxTokens * OUTPUT_MICRO_USD_PER_TOKEN;
}

/** NOTES_ENABLED kill switch. Unset or empty means on; false, 0, off or no means off. */
export function notesEnabled(value: string | undefined): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return !["false", "0", "off", "no"].includes(v);
}

/** NOTES_DAILY_SPEND_CAP_USD, default 0.50. Anything not a finite number at or above 0 is the default. */
export function dailyCapMicroUsd(value: string | undefined): number {
  const v = (value ?? "").trim();
  const n = v === "" ? NaN : Number(v);
  const usd = Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP_USD;
  return Math.floor(usd * 1_000_000 + 1e-6);
}

/** UTC day number for a timestamp in ms. */
export function utcDay(nowMs: number): number {
  return Math.floor(nowMs / 86_400_000);
}

/**
 * Client IP for the per-IP limit. Never stored beyond the limiter window.
 *
 * On Vercel (VERCEL=1) the edge overwrites x-forwarded-for and x-vercel-forwarded-for with the
 * client's public IP ("to prevent IP spoofing", Vercel request headers docs), so both are trusted.
 * Anywhere else a client can send either header. There x-vercel-forwarded-for is ignored and the
 * rightmost x-forwarded-for hop is used: the one the proxy in front of the app appended. A self-
 * hosted deploy must sit behind a proxy that appends it; bare `next start` fills x-forwarded-for
 * only when the client did not, so there the spend cap is the only real limit.
 */
export function clientIp(headers: Headers, onVercel: boolean): string {
  const hops = (v: string | null) =>
    (v ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => x !== "");
  if (onVercel) {
    return (
      hops(headers.get("x-vercel-forwarded-for"))[0] ??
      hops(headers.get("x-forwarded-for"))[0] ??
      hops(headers.get("x-real-ip"))[0] ??
      "unknown"
    );
  }
  return (
    hops(headers.get("x-forwarded-for")).at(-1) ?? hops(headers.get("x-real-ip"))[0] ?? "unknown"
  );
}

/** How often the limiter drops expired keys, and the most keys it keeps. */
export const LIMITER_SWEEP_MS = 60_000;
export const LIMITER_MAX_KEYS = 10_000;

/**
 * Sliding window: at most `limit` hits per `windowMs` per key. A take() reads one key; expired
 * keys are swept at most once a minute, and past maxKeys the least recently used key is dropped,
 * so a flood of made-up IPs cannot grow the per-request cost or the memory without bound.
 */
export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  readonly #hits = new Map<string, number[]>();
  #lastSweep = -Infinity;

  constructor(limit = IP_LIMIT, windowMs = IP_WINDOW_MS, maxKeys = LIMITER_MAX_KEYS) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Records a hit and returns true when the key is under its limit; false changes nothing. */
  take(key: string, nowMs: number): boolean {
    this.#sweep(nowMs);
    const hits = this.#live(key, nowMs);
    if (hits.length >= this.limit) return false;
    hits.push(nowMs);
    // Re-insert so Map order is least recently used first.
    this.#hits.delete(key);
    this.#hits.set(key, hits);
    while (this.#hits.size > this.maxKeys) {
      const oldest = this.#hits.keys().next().value;
      if (oldest === undefined) break;
      this.#hits.delete(oldest);
    }
    return true;
  }

  /** Hits left for a key in the current window. */
  remaining(key: string, nowMs: number): number {
    return this.limit - this.#live(key, nowMs).length;
  }

  /** Number of keys held, for tests. */
  get size(): number {
    return this.#hits.size;
  }

  #live(key: string, nowMs: number): number[] {
    return (this.#hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
  }

  #sweep(nowMs: number): void {
    if (nowMs - this.#lastSweep < LIMITER_SWEEP_MS) return;
    this.#lastSweep = nowMs;
    for (const [k, hits] of this.#hits) {
      const kept = hits.filter((t) => nowMs - t < this.windowMs);
      if (kept.length === 0) this.#hits.delete(k);
      else this.#hits.set(k, kept);
    }
  }
}

/**
 * Daily spend ledger, reset at 00:00 UTC. A call reserves its worst case first, so concurrent
 * calls on one instance cannot overshoot, then settles to its real usage. A day's committed
 * spend is settled amounts plus open reservations.
 */
export class SpendLedger {
  readonly capMicroUsd: number;
  #day = -1;
  #settled = 0;
  #nextId = 1;
  readonly #open = new Map<number, number>();

  constructor(capMicroUsd: number) {
    this.capMicroUsd = capMicroUsd;
  }

  #roll(nowMs: number): void {
    const d = utcDay(nowMs);
    if (d !== this.#day) {
      this.#day = d;
      this.#settled = 0;
      this.#open.clear();
    }
  }

  /** Settled plus reserved micro-USD for today. */
  committed(nowMs: number): number {
    this.#roll(nowMs);
    let sum = this.#settled;
    for (const v of this.#open.values()) sum += v;
    return sum;
  }

  /** Reservation id, or null when the reservation would pass the cap. */
  reserve(microUsd: number, nowMs: number): number | null {
    if (this.committed(nowMs) + microUsd > this.capMicroUsd) return null;
    const id = this.#nextId++;
    this.#open.set(id, microUsd);
    return id;
  }

  /** Replace a reservation with the real cost. A reservation from a past day is dropped. */
  settle(id: number, actualMicroUsd: number, nowMs: number): void {
    this.#roll(nowMs);
    if (!this.#open.delete(id)) return;
    this.#settled += actualMicroUsd;
  }

  /** Drop a reservation for a call that cost nothing. */
  release(id: number, nowMs: number): void {
    this.#roll(nowMs);
    this.#open.delete(id);
  }
}

/** Set when Anthropic reports a spend limit: no model calls until the next UTC day. */
export class SpentOut {
  #untilDay = -1;

  trip(nowMs: number): void {
    this.#untilDay = utcDay(nowMs) + 1;
  }

  active(nowMs: number): boolean {
    return utcDay(nowMs) < this.#untilDay;
  }
}
