import type { UpcomingMeeting } from "@albert/shared-types";

export type ScheduleView = "day" | "week" | "month";

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
