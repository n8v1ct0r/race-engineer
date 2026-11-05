// The shared cursor store (lib/cursor-store.ts): one snapshot, change-only notifications, and
// which sources count as a person moving the cursor.

import { describe, expect, it } from "vitest";
import { createCursorStore, isUserSource } from "./cursor-store.ts";

describe("cursor store", () => {
  it("starts at grid index 0 in distance mode, from init", () => {
    expect(createCursorStore().get()).toEqual({ mode: "distance", i: 0, source: "init" });
    expect(createCursorStore({ mode: "time", tMs: 500 }).get()).toEqual({
      mode: "time",
      tMs: 500,
      source: "init",
    });
  });

  it("notifies on a change and stays quiet on a repeat", () => {
    const store = createCursorStore();
    let calls = 0;
    store.subscribe(() => calls++);

    store.set({ mode: "distance", i: 10 }, "keyboard");
    expect(calls).toBe(1);
    expect(store.get()).toEqual({ mode: "distance", i: 10, source: "keyboard" });

    store.set({ mode: "distance", i: 10 }, "keyboard");
    expect(calls).toBe(1);

    // Same place, another source: charts need to know who moved it.
    store.set({ mode: "distance", i: 10 }, "scrub");
    expect(calls).toBe(2);

    store.set({ mode: "time", tMs: 10 }, "scrub");
    expect(calls).toBe(3);
    store.set({ mode: "time", tMs: 10 }, "scrub");
    expect(calls).toBe(3);
  });

  it("stops calling a listener once it unsubscribes", () => {
    const store = createCursorStore();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ mode: "distance", i: 1 }, "pointer");
    off();
    store.set({ mode: "distance", i: 2 }, "pointer");
    expect(calls).toBe(1);
    expect(store.get()).toEqual({ mode: "distance", i: 2, source: "pointer" });
  });

  it("counts every source but the replay loop and the initial state as a person", () => {
    expect(isUserSource("replay")).toBe(false);
    expect(isUserSource("init")).toBe(false);
    for (const s of ["pointer", "touch", "scrub", "keyboard", "corner"] as const) {
      expect(isUserSource(s)).toBe(true);
    }
  });
});
