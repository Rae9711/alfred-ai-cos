import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  groupMeetingsByDate,
  localDateKeyFromDate,
  meetingsForDay,
  minutesFromMidnight,
  timelineHours,
  weekDaysMondayFirst,
} from "./schedule";

describe("schedule helpers", () => {
  it("groups meetings by local date", () => {
    const groups = groupMeetingsByDate([
      {
        id: "1",
        title: "Morning",
        start_time: "2026-06-29T14:00:00.000Z",
        end_time: null,
        location: null,
        attendees: [],
        prep_required: false,
      },
      {
        id: "2",
        title: "Afternoon",
        start_time: "2026-06-30T18:00:00.000Z",
        end_time: null,
        location: null,
        attendees: [],
        prep_required: false,
      },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.items).toHaveLength(1);
  });

  it("builds a padded month grid", () => {
    const rows = buildMonthGrid(2026, 5); // June 2026
    const cells = rows.flat().filter(Boolean);
    expect(cells).toHaveLength(30);
  });

  it("formats local date keys", () => {
    const key = localDateKeyFromDate(new Date(2026, 5, 29));
    expect(key).toBe("2026-06-29");
  });

  it("filters meetings for a day", () => {
    const day = new Date(2026, 5, 29);
    const items = meetingsForDay(
      [
        {
          id: "1",
          title: "A",
          start_time: "2026-06-29T14:00:00.000Z",
          end_time: "2026-06-29T15:00:00.000Z",
          location: null,
          attendees: [],
          prep_required: false,
        },
        {
          id: "2",
          title: "B",
          start_time: "2026-06-30T14:00:00.000Z",
          end_time: null,
          location: null,
          attendees: [],
          prep_required: false,
        },
      ],
      day,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("A");
  });

  it("builds monday-first week strip", () => {
    const days = weekDaysMondayFirst(new Date(2026, 5, 29)); // Sunday Jun 29
    expect(days).toHaveLength(7);
    expect(days[0]!.getDay()).toBe(1); // Monday
  });

  it("computes timeline hours from events", () => {
    const range = timelineHours([
      {
        id: "1",
        title: "Mid",
        start_time: "2026-06-29T15:00:00.000Z",
        end_time: "2026-06-29T16:00:00.000Z",
        location: null,
        attendees: [],
        prep_required: false,
      },
    ]);
    expect(range.endHour).toBeGreaterThan(range.startHour);
    expect(minutesFromMidnight("2026-06-29T15:30:00.000Z")).toBeGreaterThan(0);
  });
});
