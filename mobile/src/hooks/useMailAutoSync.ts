// Foreground mail sync: poll Gmail on a timer, when the app returns active, and when
// a new-mail push arrives while the app is open.

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import * as Notifications from "expo-notifications";

const POLL_MS = 45_000;
const MIN_GAP_MS = 15_000;

export function useMailAutoSync(syncAndRefresh: () => Promise<void>) {
  const lastSyncAt = useRef(0);
  const syncing = useRef(false);

  useEffect(() => {
    const run = async (force = false) => {
      const now = Date.now();
      if (syncing.current) return;
      if (!force && now - lastSyncAt.current < MIN_GAP_MS) return;
      syncing.current = true;
      try {
        await syncAndRefresh();
        lastSyncAt.current = Date.now();
      } catch {
        // MailboxContext already sets error state.
      } finally {
        syncing.current = false;
      }
    };

    const onAppState = (state: AppStateStatus) => {
      if (state === "active") void run(false);
    };

    const poll = setInterval(() => {
      if (AppState.currentState === "active") void run(false);
    }, POLL_MS);

    const onPush = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as { type?: string };
      if (data?.type === "new_mail") void run(true);
    });

    const appSub = AppState.addEventListener("change", onAppState);

    return () => {
      clearInterval(poll);
      onPush.remove();
      appSub.remove();
    };
  }, [syncAndRefresh]);
}
