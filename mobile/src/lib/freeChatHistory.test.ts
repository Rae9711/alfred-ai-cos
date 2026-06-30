import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

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

import {
  clearFreeChatHistory,
  loadFreeChatHistory,
  saveFreeChatHistory,
  subscribeFreeChatCleared,
} from "./freeChatHistory";

const STORAGE_KEY = "albert.ask.freeChat.v1";

beforeEach(() => {
  store.clear();
});

describe("freeChatHistory", () => {
  it("returns null when nothing is stored", async () => {
    expect(await loadFreeChatHistory()).toBeNull();
  });

  it("round-trips messages", async () => {
    const messages = [
      { role: "alfred" as const, text: "Hi", ts: "now" },
      { role: "user" as const, text: "Hello", ts: "now" },
    ];
    await saveFreeChatHistory(messages);
    expect(await loadFreeChatHistory()).toEqual(messages);
  });

  it("recovers from corrupt JSON", async () => {
    store.set(STORAGE_KEY, "{bad");
    expect(await loadFreeChatHistory()).toBeNull();
  });

  it("notifies subscribers on clear", async () => {
    await saveFreeChatHistory([
      { role: "user", text: "x", ts: "now" },
    ]);
    let cleared = false;
    const unsub = subscribeFreeChatCleared(() => {
      cleared = true;
    });
    await clearFreeChatHistory();
    unsub();
    expect(cleared).toBe(true);
    expect(await loadFreeChatHistory()).toBeNull();
  });
});
