// Schedule on-device reminder notifications for tasks with remind_at.
// Complements server push (Expo) so reminders fire even when offline.

import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { type Task } from "@albert/shared-types";

export type ReminderScheduleInput = {
  taskId: string;
  title: string;
  remindAt: string;
};

function notificationId(taskId: string): string {
  return `task-reminder-${taskId}`;
}

export async function ensureLocalReminderPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return true;
  const next = await Notifications.requestPermissionsAsync();
  return next.status === "granted";
}

export async function scheduleLocalTaskReminder(
  input: ReminderScheduleInput,
): Promise<string | null> {
  const when = new Date(input.remindAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    return null;
  }
  const granted = await ensureLocalReminderPermission();
  if (!granted) return null;

  const id = notificationId(input.taskId);
  await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);

  return Notifications.scheduleNotificationAsync({
    identifier: id,
    content: {
      title: input.title,
      body: "Reminder from Alfred",
      data: { type: "reminder", task_id: input.taskId, deep_link: "/today" },
      sound: Platform.OS === "ios" ? "default" : undefined,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
    },
  });
}

export async function cancelLocalTaskReminder(taskId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(notificationId(taskId)).catch(
    () => undefined,
  );
}

export async function syncLocalRemindersForTasks(tasks: Task[]): Promise<void> {
  const granted = await ensureLocalReminderPermission();
  if (!granted) return;

  const keep = new Set<string>();
  for (const task of tasks) {
    if (!task.remind_at) continue;
    const id = await scheduleLocalTaskReminder({
      taskId: task.id,
      title: task.title,
      remindAt: task.remind_at,
    });
    if (id) keep.add(task.id);
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const n of scheduled) {
    const data = n.content.data as { type?: string; task_id?: string };
    if (data?.type !== "reminder" || !data.task_id) continue;
    if (!keep.has(data.task_id)) {
      await Notifications.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

export async function scheduleFromAssistantResponse(res: {
  action: string;
  task_id?: string | null;
  task_title?: string | null;
  remind_at?: string | null;
}): Promise<void> {
  if (res.action !== "created" || !res.task_id || !res.remind_at) return;
  await scheduleLocalTaskReminder({
    taskId: res.task_id,
    title: res.task_title ?? "Reminder",
    remindAt: res.remind_at,
  });
}
