/**
 * Fulfill assistant `device_book` responses by writing via EventKit.
 * Returns true when the client handled the write (caller should treat as booked).
 */
import type { AssistantAskResponse } from "@albert/shared-types";

import { createDeviceCalendarEvent } from "@/lib/appleCalendar";

export async function fulfillDeviceCalendarBook(
  res: AssistantAskResponse,
): Promise<AssistantAskResponse> {
  if (res.action !== "device_book" || !res.device_calendar) {
    return res;
  }
  await createDeviceCalendarEvent({
    title: res.device_calendar.title,
    start: res.device_calendar.start,
    end: res.device_calendar.end,
    location: res.device_calendar.location,
  });
  return {
    ...res,
    action: "booked",
    reply: res.reply || `Added “${res.device_calendar.title}” to Apple Calendar.`,
  };
}
