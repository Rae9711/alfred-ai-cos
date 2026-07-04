// @vitest-environment jsdom
//
// useApproveAction wraps api.approveAction with the shared avatar feedback
// (XP on success, error mood on failure) — this is the fix for the design
// review finding that ApprovalSheet and ActionApprovalScreen drifted
// independently. Renders through the real CompanionAvatarProvider (same
// pattern as CompanionAvatarContext.test.tsx) so XP/mood assertions exercise
// real logic, not a mock.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
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

const { approveActionMock } = vi.hoisted(() => ({
  approveActionMock: vi.fn(),
}));

vi.mock("@/api/client", () => ({
  api: { approveAction: approveActionMock },
}));

import {
  CompanionAvatarProvider,
  useCompanionAvatar,
} from "@/context/CompanionAvatarContext";
import { useApproveAction } from "./useApproveAction";

const wrapper = ({ children }: { children: ReactNode }) => (
  <CompanionAvatarProvider>{children}</CompanionAvatarProvider>
);

beforeEach(() => {
  store.clear();
  approveActionMock.mockReset();
});

describe("useApproveAction", () => {
  it("grants task_completed XP only after the server confirms the approval", async () => {
    approveActionMock.mockResolvedValue({ id: "a1", status: "approved" });
    const { result } = renderHook(
      () => ({ approve: useApproveAction(), avatar: useCompanionAvatar() }),
      { wrapper },
    );
    expect(result.current.avatar.meta.xp).toBe(0);

    await act(async () => {
      await result.current.approve.approveAction("a1", true);
    });

    expect(approveActionMock).toHaveBeenCalledWith("a1", true);
    expect(result.current.avatar.meta.xp).toBe(40); // task_completed base XP
  });

  it("flashes the error mood and grants no XP when the server rejects", async () => {
    approveActionMock.mockRejectedValue(new Error("Approval failed"));
    const { result } = renderHook(
      () => ({ approve: useApproveAction(), avatar: useCompanionAvatar() }),
      { wrapper },
    );

    await act(async () => {
      await expect(
        result.current.approve.approveAction("a1"),
      ).rejects.toThrow("Approval failed");
    });

    expect(approveActionMock).toHaveBeenCalledWith("a1", false);
    expect(result.current.avatar.meta.xp).toBe(0);
    expect(result.current.avatar.state).toBe("error");
  });
});
