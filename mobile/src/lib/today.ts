// Pure, UI-free logic for the Today/priority surfaces. Extracted from the screen
// components so it can be unit-tested without a React Native runtime. The components
// import these; the tests import these. No RN, no side effects.

import type { TodayPriority } from "@albert/shared-types";

// Time-of-day greeting, matching the prototype's thresholds.
export function greetingFor(hour: number): string {
  if (hour < 5) return "Still up,";
  if (hour < 12) return "Good morning,";
  if (hour < 18) return "Good afternoon,";
  return "Good evening,";
}

// REVISION (timezone bug fix): the backend sends due dates as date-only strings
// ("2026-05-19"). Per the ECMAScript spec, `new Date("2026-05-19")` parses that
// as midnight **UTC** — but in any timezone west of UTC (this machine is UTC-4),
// midnight UTC is still the *previous* local evening. So `due.getDate()` returned
// 18, the "is it due today?" comparison failed, and a task due today rendered as
// yesterday's date pill ("MON, MAY 18"). Every displayed deadline was off by one
// day for users west of Greenwich.
//
// Fix: when the string is date-only, build the Date from its year/month/day parts,
// which the Date constructor interprets in *local* time — matching what "due on
// May 19" means to the person reading the screen. Full ISO timestamps (with a
// time component) carry their own timezone info, so those still go through the
// normal parser untouched.
function parseDueDate(raw: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return new Date(Number(y), Number(m) - 1, Number(d)); // local midnight
  }
  return new Date(raw);
}

// Urgency pill for a priority: warn "Today" when it's high-priority or due today,
// else an accent pill carrying the deadline. `now` is injectable for testing.
export function urgencyFor(
  item: Pick<TodayPriority, "priority" | "due_date">,
  now: Date = new Date(),
): { label: string; warn: boolean } {
  const urgent = item.priority === "critical" || item.priority === "high";
  if (!item.due_date) return { label: urgent ? "Today" : "Soon", warn: urgent };

  // REVISION: was `new Date(item.due_date)` — see parseDueDate above for why
  // that mis-parsed date-only strings into the previous local day.
  const due = parseDueDate(item.due_date);
  if (Number.isNaN(due.getTime())) {
    return { label: urgent ? "Today" : "Soon", warn: urgent };
  }
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  if (sameDay) return { label: "Today", warn: true };

  const label = due
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
  return { label, warn: urgent };
}

// First name from a full name (used in the greeting and person chips).
export function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}
