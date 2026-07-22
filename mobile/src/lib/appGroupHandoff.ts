// Drain keyboard-confirmed actions from the App Group and schedule local
// reminders only when the user already confirmed a time-bearing action.

import { AppState, type AppStateStatus, Platform } from "react-native";
import Constants from "expo-constants";

import {
  AppGroupSyncError,
  drainKeyboardConfirmedActions,
  setSharedApiBaseUrl,
  setSharedAuthToken,
  type ConfirmedAction,
} from "alfred-shared-storage";
import { scheduleLocalTaskReminder } from "./taskReminders";

export type SyncAuthResult = { ok: boolean; error?: string };

/**
 * Sync the session token + API base URL into the App Group so the keyboard
 * extension can call Alfred's backend (requires Full Access).
 * Soft-fails with `{ ok: false }` so login / cold-start never crash when the
 * native bridge is missing (old IPA) or App Group is mis-provisioned.
 */
export async function syncAuthToAppGroup(token: string | null): Promise<SyncAuthResult> {
  if (Platform.OS !== "ios") return { ok: true };
  const base =
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
    "https://alfredaitech.com";
  try {
    await setSharedApiBaseUrl(base);
    await setSharedAuthToken(token);
    return { ok: true };
  } catch (e) {
    const message =
      e instanceof AppGroupSyncError
        ? e.message
        : e instanceof Error
          ? e.message
          : "同步失败";
    return { ok: false, error: message };
  }
}

/**
 * On foreground, pull any actions the keyboard confirmed and schedule reminders
 * for those with remind_at. Persistence already happened server-side in confirm.
 */
export async function drainAndScheduleFromKeyboard(): Promise<ConfirmedAction[]> {
  if (Platform.OS !== "ios") return [];
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
}

/** Subscribe once at app root — drains on active. */
export function startAppGroupHandoffListener(
  onDrained?: (items: ConfirmedAction[]) => void,
): () => void {
  if (Platform.OS !== "ios") return () => undefined;

  const handle = (state: AppStateStatus) => {
    if (state !== "active") return;
    void drainAndScheduleFromKeyboard().then((items) => {
      if (items.length > 0) onDrained?.(items);
    });
  };

  const sub = AppState.addEventListener("change", handle);
  handle("active");
  return () => sub.remove();
}
