// @vitest-environment jsdom
//
// CompanionAvatarProvider renders no host components (just a context provider),
// so it can be exercised with plain react-dom under jsdom — no RN runtime needed.
// Storage is mocked at the secureStorage boundary, same as companionMeta.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const store = new Map<string, string>();

vi.mock("@/lib/secureStorage", () => ({
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

import { getDefaultMeta } from "@/lib/agentMeta";
import {
  CompanionAvatarProvider,
  useCompanionAvatar,
} from "./CompanionAvatarContext";

const META_KEY = "albert.companion.meta";

const wrapper = ({ children }: { children: ReactNode }) => (
  <CompanionAvatarProvider>{children}</CompanionAvatarProvider>
);

beforeEach(() => {
  store.clear();
});

describe("useCompanionAvatar", () => {
  it("throws when used outside the provider", () => {
    expect(() => renderHook(() => useCompanionAvatar())).toThrow(
      /within <CompanionAvatarProvider>/,
    );
  });

  it("starts with defaults and hydrates persisted meta from storage", async () => {
    store.set(META_KEY, JSON.stringify({ xp: 200, level: 3, color: "#ABCDEF" }));
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    expect(result.current.meta).toEqual(getDefaultMeta());
    await waitFor(() => expect(result.current.meta.level).toBe(3));
    expect(result.current.meta.xp).toBe(200);
    expect(result.current.meta.color).toBe("#ABCDEF");
  });
});

describe("placement and mood", () => {
  it("derives the thinking mood while Ask is in flight", async () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    expect(result.current.state).toBe("idle");
    act(() => result.current.setThinking(true));
    expect(result.current.state).toBe("thinking");
    act(() => result.current.setThinking(false));
    expect(result.current.state).toBe("idle");
  });

  it("tracks placement updates", () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    expect(result.current.placement).toBe("home");
    act(() => result.current.setPlacement("today"));
    expect(result.current.placement).toBe("today");
  });
});

describe("flashState", () => {
  it("overrides the placement-derived mood, then auto-reverts", async () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    expect(result.current.state).toBe("idle");
    act(() => result.current.flashState("error", 20));
    expect(result.current.state).toBe("error");
    await waitFor(() => expect(result.current.state).toBe("idle"));
  });

  it("takes precedence over a concurrent placement/thinking mood change", async () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    act(() => result.current.flashState("error", 50));
    act(() => result.current.setThinking(true));
    expect(result.current.state).toBe("error");
    await waitFor(() => expect(result.current.state).toBe("thinking"));
  });
});

describe("recordEvent", () => {
  it("updates the in-memory meta and persists the XP gain", async () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    await act(() => result.current.recordEvent("agent_message_sent"));
    expect(result.current.meta.xp).toBe(5);
    expect(JSON.parse(store.get(META_KEY)!).xp).toBe(5);
  });

  it("resolves leveledUp: false when the event doesn't cross a level threshold", async () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    let resolved: Awaited<ReturnType<typeof result.current.recordEvent>>;
    await act(async () => {
      resolved = await result.current.recordEvent("agent_message_sent");
    });
    expect(resolved!).toEqual({ leveledUp: false, level: 1 });
  });

  it("resolves leveledUp: true with the new level when a threshold is crossed", async () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    // 40 XP per task_completed; level 2 starts at 80 — the 2nd call crosses it.
    await act(() => result.current.recordEvent("task_completed"));
    let resolved: Awaited<ReturnType<typeof result.current.recordEvent>>;
    await act(async () => {
      resolved = await result.current.recordEvent("task_completed");
    });
    expect(resolved!).toEqual({ leveledUp: true, level: 2 });
    expect(result.current.meta.level).toBe(2);
  });
});

describe("setColor", () => {
  it("updates the in-memory context, not just storage (bug regression)", async () => {
    const { result } = renderHook(() => useCompanionAvatar(), { wrapper });
    await act(() => result.current.setColor("#FF8800"));
    // Pre-fix, storage changed but result.current.meta.color stayed default
    // until the next app launch.
    expect(result.current.meta.color).toBe("#FF8800");
    expect(JSON.parse(store.get(META_KEY)!).color).toBe("#FF8800");
  });
});

describe("provider rendering", () => {
  it("renders children", () => {
    const { getByText } = render(
      <CompanionAvatarProvider>
        <span>child</span>
      </CompanionAvatarProvider>,
    );
    expect(getByText("child")).toBeTruthy();
  });
});
