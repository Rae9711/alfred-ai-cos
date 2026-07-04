// Shared approval-action wrapper. The design review's central finding was that
// ApprovalSheet.tsx and ActionApprovalScreen.tsx each called api.approveAction
// directly with their own try/catch, so avatar/XP feedback silently differed
// depending on which screen the user approved from. Routing both through this
// hook makes that feedback structural instead of duplicated — neither screen
// calls api.approveAction directly anymore.
//
// Design: docs/designs/2026-07-02-avatar-interaction-space.md (T-D1/T-D2/T-D3).

import { useCallback } from "react";
import type { ActionProposal } from "@albert/shared-types";

import { api } from "@/api/client";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";

export function useApproveAction() {
  const { recordEvent, flashState } = useCompanionAvatar();

  const approveAction = useCallback(
    async (actionId: string, confirm = false): Promise<ActionProposal> => {
      try {
        const proposal = await api.approveAction(actionId, confirm);
        // XP only after the server confirms the approval — never optimistic.
        await recordEvent("task_completed");
        return proposal;
      } catch (e) {
        flashState("error");
        throw e;
      }
    },
    [recordEvent, flashState],
  );

  return { approveAction };
}
