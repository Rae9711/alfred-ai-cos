// Tests for the persistence layer: JSON merge on load, corrupt-storage recovery,
// and — critically — serialization of concurrent read-modify-write cycles, the
// race the original PR shipped (Ask can fire several in-flight messages).

import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory async storage double. Reads/writes resolve on a later microtask so
// unserialized read-modify-write cycles would actually interleave under test.
const store = new Map<string, string>();

// NOTE: mocked via the relative specifier. companionMeta.ts imports
// "@/lib/secureStorage", and vitest resolves both spellings to the same module id,
// so this factory intercepts the aliased import too — the real module (and its
// react-native import, which has no Node-runnable entry) never loads.
vi.mock("./secureStorage", () => ({
  readSecureItem: vi.fn(async (key: string) => {
    await Promise.resolve();
    return store.get(key) ?? null;
  }),
  writeSecureItem: vi.fn(async (key: string, value: string) => {
    await Promise.resolve();
    store.set(key, value);
  }),
  deleteSecureItem: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

import { getDefaultMeta } from "./agentMeta";
import {
  loadCompanionMeta,
  moodForContext,
  recordCompanionEvent,
  saveCompanionMeta,
  updateCompanionColor,
} from "./companionMeta";

const META_KEY = "albert.companion.meta";

beforeEach(() => {
  store.clear();
});

describe("loadCompanionMeta", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await loadCompanionMeta()).toEqual(getDefaultMeta());
  });

  it("merges a partial stored payload over defaults", async () => {
    store.set(META_KEY, JSON.stringify({ xp: 120, level: 2 }));
    const meta = await loadCompanionMeta();
    expect(meta.xp).toBe(120);
    expect(meta.level).toBe(2);
    // Fields absent from storage come from defaults.
    expect(meta.color).toBe(getDefaultMeta().color);
    expect(meta.todayCounters).toEqual(getDefaultMeta().todayCounters);
  });

  it("recovers with defaults when storage holds corrupt JSON", async () => {
    store.set(META_KEY, "{not json");
    expect(await loadCompanionMeta()).toEqual(getDefaultMeta());
  });
});

describe("saveCompanionMeta / round trip", () => {
  it("persists meta that loads back identically", async () => {
    const meta = { ...getDefaultMeta(), xp: 333, level: 4, color: "#AA0000" };
    await saveCompanionMeta(meta);
    expect(await loadCompanionMeta()).toEqual(meta);
  });
});

describe("recordCompanionEvent", () => {
  it("applies the event and persists the result", async () => {
    const { meta, gainedXp } = await recordCompanionEvent("agent_message_sent");
    expect(gainedXp).toBeGreaterThan(0);
    expect((await loadCompanionMeta()).xp).toBe(meta.xp);
  });

  it("does not lose XP when events fire concurrently (race regression)", async () => {
    // Five in-flight messages at once. Pre-fix, each load saw xp=0 and the last
    // save won — total xp 5 instead of 25. The write queue serializes them.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => recordCompanionEvent("agent_message_sent")),
    );
    const persisted = await loadCompanionMeta();
    expect(persisted.xp).toBe(25); // 5 events × 5 base XP, under the daily cap
    expect(persisted.todayCounters.agent_message_sent).toBe(5);
    // The last resolved result reflects the fully accumulated state.
    expect(results.at(-1)?.meta.xp).toBe(25);
  });
});

describe("updateCompanionColor", () => {
  it("persists the new color and returns the updated meta", async () => {
    const next = await updateCompanionColor("#123456");
    expect(next.color).toBe("#123456");
    expect((await loadCompanionMeta()).color).toBe("#123456");
  });

  it("serializes with concurrent XP events instead of clobbering them", async () => {
    const [, colored] = await Promise.all([
      recordCompanionEvent("agent_message_sent"),
      updateCompanionColor("#654321"),
    ]);
    const persisted = await loadCompanionMeta();
    expect(persisted.color).toBe("#654321");
    expect(persisted.xp).toBe(5); // the XP write survived the color write
    expect(colored.xp).toBe(5);
  });
});

describe("moodForContext", () => {
  it("prioritizes sleep over thinking, thinking over idle", () => {
    expect(
      moodForContext({ placement: "ask", thinking: true, sleeping: true }),
    ).toBe("sleep");
    expect(
      moodForContext({ placement: "ask", thinking: true, sleeping: false }),
    ).toBe("thinking");
    expect(
      moodForContext({ placement: "home", thinking: false, sleeping: false }),
    ).toBe("idle");
  });
});
