import type { CaptureResponse } from "@albert/shared-types";

import type { Translation } from "@/i18n/locales";

/** Warm butler acknowledgment tied to parsed capture output (T-AV2). */
export function buildCaptureAcknowledgment(
  result: CaptureResponse,
  t: Translation["capture"],
): string {
  const { tasks, detected_project: project } = result;
  const n = tasks.length;

  if (n === 0) return t.ackNothing;

  if (n === 1) {
    const task = tasks[0]!;
    if (task.remind_at) {
      return t.ackReminder(task.title, task.remind_at);
    }
    if (task.due_date) {
      return t.ackDue(task.title, task.due_date);
    }
    if (project) {
      return t.ackOneWithProject(task.title, project);
    }
    return t.ackOne(task.title);
  }

  const first = tasks[0]!.title;
  if (project) {
    return t.ackManyWithProject(n, first, project);
  }
  return t.ackMany(n, first);
}
