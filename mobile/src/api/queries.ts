// React Query hooks over the typed API client. Screens use these instead of calling
// `api.*` inside ad-hoc useState/useEffect, which gives us caching, dedup, retries, and
// a single source of truth for the cache keys (so mutations can invalidate precisely).
//
// Query keys live in one place (`queryKeys`) so a hook and the code that invalidates it
// can never drift apart on the key shape.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { CommitmentStatus, TaskStatus } from "@albert/shared-types";

import { api } from "./client";

export const queryKeys = {
  today: ["today"] as const,
  pendingActions: ["pendingActions"] as const,
  tasks: ["tasks"] as const,
  me: ["me"] as const,
};

export function useToday() {
  return useQuery({ queryKey: queryKeys.today, queryFn: () => api.getToday() });
}

export function usePendingActions() {
  return useQuery({
    queryKey: queryKeys.pendingActions,
    queryFn: () => api.listPendingActions(),
  });
}

export function useTasks() {
  return useQuery({ queryKey: queryKeys.tasks, queryFn: () => api.listTasks() });
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => api.getMe() });
}

/**
 * Refetch everything the Today surface depends on. Called after any write (mark done,
 * dismiss, snooze, sync) so the dashboard, task list, and pending-approval count all
 * reflect the change without each screen re-implementing the fan-out.
 */
export function invalidateToday(qc: QueryClient): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: queryKeys.today }),
    qc.invalidateQueries({ queryKey: queryKeys.tasks }),
    qc.invalidateQueries({ queryKey: queryKeys.pendingActions }),
  ]);
}

/** Trigger a backend sync, then refresh the Today data set on success. */
export function useSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.sync(),
    onSuccess: () => invalidateToday(qc),
  });
}

/** Update a commitment's status (done / dismissed / snoozed), then refresh Today. */
export function useUpdateCommitmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: CommitmentStatus }) =>
      api.updateCommitmentStatus(id, status),
    onSuccess: () => invalidateToday(qc),
  });
}

/** Update a task's status (e.g. complete a quick win), then refresh Today. */
export function useUpdateTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      api.updateTaskStatus(id, status),
    onSuccess: () => invalidateToday(qc),
  });
}
