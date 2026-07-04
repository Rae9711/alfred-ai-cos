import type { Task, UpcomingMeeting } from "@albert/shared-types";

export type ScheduleView = "day" | "week" | "month";

export type ScheduleTimelineItem = {
  id: string;
  title: string;
  start_time: string;
  end_time: string | null;
  kind: "event" | "task";
  location?: string | null;
  task?: Task;
  event?: UpcomingMeeting;
};

/** Stable local calendar date key (YYYY-MM-DD). */
export function dateKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return localDateKeyFromDate(d);
}

export function localDateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function groupMeetingsByDate(
  meetings: UpcomingMeeting[],
): { dateKey: string; label: string; items: UpcomingMeeting[] }[] {
  const map = new Map<string, UpcomingMeeting[]>();
  for (const m of meetings) {
    const key = dateKey(m.start_time);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(m);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({
      dateKey: key,
      label: formatDayLabel(key),
      items: items.sort(
        (a, b) =>
          new Date(a.start_time ?? 0).getTime() -
          new Date(b.start_time ?? 0).getTime(),
      ),
    }));
}

export function formatDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y!, m! - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function eventDateKeys(meetings: UpcomingMeeting[]): Set<string> {
  return new Set(meetings.map((m) => dateKey(m.start_time)).filter(Boolean));
}

/** Month grid rows (Mon-first); null = padding cell. */
export function buildMonthGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const startPad = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: startPad }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Monday-first dates for the week containing `anchor`. */
export function weekDaysMondayFirst(anchor: Date = new Date()): Date[] {
  const d = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const mondayOffset = (d.getDay() + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return day;
  });
}

export function meetingsForDay(
  meetings: UpcomingMeeting[],
  day: Date,
): UpcomingMeeting[] {
  const key = localDateKeyFromDate(day);
  return meetings
    .filter((m) => dateKey(m.start_time) === key)
    .sort(
      (a, b) =>
        new Date(a.start_time ?? 0).getTime() -
        new Date(b.start_time ?? 0).getTime(),
    );
}

/** Open tasks with remind_at or due_date on the given local day. */
export function tasksForDay(tasks: Task[], day: Date): Task[] {
  const key = localDateKeyFromDate(day);
  return tasks
    .filter((task) => {
      if (task.remind_at && dateKey(task.remind_at) === key) return true;
      if (task.due_date === key) return true;
      return false;
    })
    .sort((a, b) => {
      const aTime = a.remind_at
        ? new Date(a.remind_at).getTime()
        : new Date(`${a.due_date}T09:00:00`).getTime();
      const bTime = b.remind_at
        ? new Date(b.remind_at).getTime()
        : new Date(`${b.due_date}T09:00:00`).getTime();
      return aTime - bTime;
    });
}

export function buildDayTimelineItems(
  meetings: UpcomingMeeting[],
  tasks: Task[],
  day: Date,
): ScheduleTimelineItem[] {
  const dayMeetings = meetingsForDay(meetings, day);
  const dayTasks = tasksForDay(tasks, day);
  const items: ScheduleTimelineItem[] = [
    ...dayMeetings.map((event) => ({
      id: `event-${event.id}`,
      title: event.title ?? "Meeting",
      start_time: event.start_time!,
      end_time: event.end_time,
      kind: "event" as const,
      location: event.location,
      event,
    })),
    ...dayTasks.map((task) => {
      const startIso =
        task.remind_at ?? `${task.due_date}T09:00:00`;
      const start = new Date(startIso);
      const end = new Date(start.getTime() + 30 * 60_000);
      return {
        id: `task-${task.id}`,
        title: task.title,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        kind: "task" as const,
        task,
      };
    }),
  ];
  return items.sort(
    (a, b) =>
      new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
  );
}

/** Timeline hour range for mixed calendar events and task reminders. */
export function timelineHoursForItems(
  items: Pick<ScheduleTimelineItem, "start_time" | "end_time">[],
): { startHour: number; endHour: number } {
  if (!items.length) return { startHour: 7, endHour: 21 };
  let minM = 24 * 60;
  let maxM = 0;
  for (const item of items) {
    const start = minutesFromMidnight(item.start_time);
    const end = start + eventDurationMinutes(item.start_time, item.end_time);
    minM = Math.min(minM, start);
    maxM = Math.max(maxM, end);
  }
  const startHour = Math.max(6, Math.floor(minM / 60) - 1);
  const endHour = Math.min(23, Math.ceil(maxM / 60) + 1);
  return { startHour, endHour: Math.max(startHour + 1, endHour) };
}

export function minutesFromMidnight(iso: string | null): number {
  if (!iso) return 0;
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function eventDurationMinutes(
  startIso: string | null,
  endIso: string | null,
): number {
  if (!startIso) return 30;
  if (!endIso) return 30;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.max(15, Math.round(ms / 60_000));
}

/** Timeline hour range that fits all events (clamped 6–22). */
export function timelineHours(
  meetings: UpcomingMeeting[],
): { startHour: number; endHour: number } {
  if (!meetings.length) return { startHour: 7, endHour: 21 };
  let minM = 24 * 60;
  let maxM = 0;
  for (const m of meetings) {
    const start = minutesFromMidnight(m.start_time);
    const end = start + eventDurationMinutes(m.start_time, m.end_time);
    minM = Math.min(minM, start);
    maxM = Math.max(maxM, end);
  }
  const startHour = Math.max(6, Math.floor(minM / 60) - 1);
  const endHour = Math.min(23, Math.ceil(maxM / 60) + 1);
  return { startHour, endHour: Math.max(startHour + 1, endHour) };
}

export function formatWeekdayShort(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function formatMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
