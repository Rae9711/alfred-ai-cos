// Drain keyboard-confirmed actions from the App Group and schedule local
// reminders only when the user already confirmed a time-bearing action.
//
// Never statically import `alfred-shared-storage` — `requireNativeModule` on a
// missing native module can hard-crash older IPAs. Always dynamic-import and
// soft-fail so login / cold start stay alive even when the bridge is absent.

import { AppState, type AppStateStatus, Platform } from "react-native";

export type SyncAuthResult = { ok: boolean; error?: string };

export type ConfirmedAction = {
  kind?: string;
  id?: string;
  title?: string;
  evidence?: string | null;
  remind_at?: string | null;
  confirmed_at?: string;
};

/**
 * Sync the session token + API base URL into the App Group so the keyboard
 * extension can call Alfred's backend (requires Full Access).
 * Soft-fails with `{ ok: false }` so login / cold-start never crash.
 */
export async function syncAuthToAppGroup(token: string | null): Promise<SyncAuthResult> {
  if (Platform.OS !== "ios") return { ok: true };
  try {
    const {
      AppGroupSyncError,
      setSharedApiBaseUrl,
      setSharedAuthToken,
    } = await import("alfred-shared-storage");
    const Constants = (await import("expo-constants")).default;
    const base =
      (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
      "https://alfredaitech.com";
    await setSharedApiBaseUrl(base);
    await setSharedAuthToken(token);
    return { ok: true };
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "同步失败";
    return { ok: false, error: message };
  }
}

/**
 * On foreground, pull any actions the keyboard confirmed and schedule reminders
 * for those with remind_at. Persistence already happened server-side in confirm.
 */
export async function drainAndScheduleFromKeyboard(): Promise<ConfirmedAction[]> {
  if (Platform.OS !== "ios") return [];
  try {
    const { drainKeyboardConfirmedActions } = await import("alfred-shared-storage");
    const { scheduleLocalTaskReminder } = await import("./taskReminders");
    const items = await drainKeyboardConfirmedActions();
    for (const item of items) {
      if (item.kind === "task" && item.id && item.remind_at) {
        await scheduleLocalTaskReminder({
          taskId: item.id,
          title: item.title ?? "Reminder",
          remindAt: item.remind_at,
        });
      }
    }
    return items;
  } catch {
    return [];
  }
}

/** Subscribe once at app root — drains on active (deferred off the cold-start path). */
export function startAppGroupHandoffListener(
  onDrained?: (items: ConfirmedAction[]) => void,
): () => void {
  if (Platform.OS !== "ios") return () => undefined;

  let cancelled = false;

  const runDrain = () => {
    if (cancelled) return;
    void drainAndScheduleFromKeyboard().then((items) => {
      if (!cancelled && items.length > 0) onDrained?.(items);
    });
  };

  const handle = (state: AppStateStatus) => {
    if (state !== "active") return;
    // Defer so AuthProvider / fonts finish first; avoids native bridge work on
    // the synchronous cold-start stack that previously hard-crashed some IPAs.
    setTimeout(runDrain, 500);
  };

  const sub = AppState.addEventListener("change", handle);
  handle(AppState.currentState);
  return () => {
    cancelled = true;
    sub.remove();
  };
}
