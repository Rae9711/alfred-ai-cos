// Shared React Query client. One instance for the whole app (created here, mounted in
// app/_layout.tsx) so every screen reads/writes the same cache — this is what lets, e.g.,
// completing a commitment on Today invalidate the same "today" data the Waiting screen reads.
//
// Defaults are tuned for a mobile app talking to a remote API:
//   • staleTime 30s   — data is considered fresh for 30s, so navigating between screens
//                        doesn't refire the same request; explicit pull-to-refresh / sync
//                        still refetches immediately via invalidation.
//   • gcTime 5m       — unused cache entries are dropped 5 minutes after the last observer
//                        unmounts, keeping memory bounded.
//   • retry 2         — transient network blips get two automatic retries before surfacing.
//   • refetchOnWindowFocus false — RN "focus" is noisy; we refetch on screen focus/sync
//                        deliberately rather than on every app foreground.

import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});
