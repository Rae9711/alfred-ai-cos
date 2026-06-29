import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  groupMeetingsByDate,
  localDateKeyFromDate,
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
});
