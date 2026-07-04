// Shared approval-action wrapper. /plan-design-review's central finding (on the
// near-term build order, 2026-07-02 — not saved to a file, only this code) was
// that ApprovalSheet.tsx and ActionApprovalScreen.tsx each called
// api.approveAction directly with their own try/catch, so avatar/XP feedback
// silently differed depending on which screen the user approved from (T-D1/
// T-D2/T-D3). Routing both through this hook makes that feedback structural
// instead of duplicated — neither screen calls api.approveAction directly.
//
// T-D4/T-D5 (same review): a level-up needs a toast-primary/avatar-peripheral
// treatment, and must reach screen-reader users too. ActionApprovalScreen has
// no toast surface (it's a top-level route reachable standalone from a
// cold-start push deep link, so it can't assume a Shell/toast provider is
// mounted) — the accessibility announcement fires here, centrally, so it's
// guaranteed regardless of that; leveledUp/level are also returned so a
// caller *with* a toast (ApprovalSheet) can fold the news into its own
// existing success toast rather than the avatar's animation being the only
// signal.

import { useCallback } from "react";
import type { ActionProposal } from "@albert/shared-types";

import { api } from "@/api/client";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { announceForAccessibility } from "@/lib/a11y";

export type ApproveActionResult = {
  proposal: ActionProposal;
  leveledUp: boolean;
  level: number;
};

export function useApproveAction() {
  const { recordEvent, flashState } = useCompanionAvatar();

  const approveAction = useCallback(
    async (actionId: string, confirm = false): Promise<ApproveActionResult> => {
      try {
        const proposal = await api.approveAction(actionId, confirm);
        // XP only after the server confirms the approval — never optimistic.
        const { leveledUp, level } = await recordEvent("task_completed");
        if (leveledUp) {
          announceForAccessibility(`Leveled up to level ${level}`);
        }
        return { proposal, leveledUp, level };
      } catch (e) {
        flashState("error");
        throw e;
      }
    },
    [recordEvent, flashState],
  );

  return { approveAction };
}
