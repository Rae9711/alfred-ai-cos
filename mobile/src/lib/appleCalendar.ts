/**
 * Device calendar via EventKit / Android Calendar (expo-calendar).
 * "Apple Calendar" = the phone's system calendars (iCloud / Apple Calendar on iOS),
 * not iCloud CalDAV OAuth. Optional native module — OTA alone is not enough.
 */
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type * as ExpoCalendar from "expo-calendar";
import type { UpcomingMeeting } from "@albert/shared-types";

export type AppleCalendarPermissionStatus =
  | "granted"
  | "denied"
  | "undetermined"
  | "unavailable";

export type DeviceCalendarEventInput = {
  title: string;
  start: string | Date;
  end: string | Date;
  notes?: string | null;
  location?: string | null;
};

export const APPLE_EVENT_ID_PREFIX = "apple:";

const ExpoCalendarNative = requireOptionalNativeModule("ExpoCalendar");

export function isAppleCalendarNativeAvailable(): boolean {
  return ExpoCalendarNative != null;
}

export function isAppleEventId(id: string): boolean {
  return id.startsWith(APPLE_EVENT_ID_PREFIX);
}

export function nativeIdFromAppleEventId(id: string): string {
  return id.startsWith(APPLE_EVENT_ID_PREFIX)
    ? id.slice(APPLE_EVENT_ID_PREFIX.length)
    : id;
}

async function loadCalendarModule(): Promise<typeof ExpoCalendar> {
  if (!isAppleCalendarNativeAvailable()) {
    throw new Error(
      "Calendar is not available in this build — reinstall Alfred from TestFlight or rebuild the app.",
    );
  }
  try {
    return await import("expo-calendar");
  } catch {
    throw new Error(
      "Calendar is not available in this build — reinstall Alfred from TestFlight or rebuild the app.",
    );
  }
}

export async function getAppleCalendarPermissionStatus(): Promise<AppleCalendarPermissionStatus> {
  if (!isAppleCalendarNativeAvailable()) return "unavailable";
  try {
    const Calendar = await loadCalendarModule();
    const { status } = await Calendar.getCalendarPermissionsAsync();
    if (status === Calendar.PermissionStatus.GRANTED) return "granted";
    if (status === Calendar.PermissionStatus.DENIED) return "denied";
    return "undetermined";
  } catch {
    return "unavailable";
  }
}

export async function requestAppleCalendarPermission(): Promise<boolean> {
  if (!isAppleCalendarNativeAvailable()) return false;
  try {
    const Calendar = await loadCalendarModule();
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === Calendar.PermissionStatus.GRANTED;
  } catch {
    return false;
  }
}

async function resolveWritableCalendarId(
  Calendar: typeof ExpoCalendar,
): Promise<string | null> {
  if (Platform.OS === "ios") {
    try {
      const def = await Calendar.getDefaultCalendarAsync();
      if (def?.id && def.allowsModifications) return def.id;
    } catch {
      // fall through
    }
  }

  const calendars = await Calendar.getCalendarsAsync(
    Calendar.EntityTypes.EVENT,
  );
  const writable = calendars.filter((c) => c.allowsModifications);
  if (writable.length === 0) return null;

  const primary =
    writable.find((c) => c.isPrimary) ??
    writable.find((c) => /icloud|apple|personal|default/i.test(c.title)) ??
    writable[0];
  return primary?.id ?? null;
}

function toDate(value: string | Date): Date {
  return typeof value === "string" ? new Date(value) : value;
}

function toIso(value: Date | string | undefined | null): string | null {
  if (value == null) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** Create on the device calendar. Throws when write is required but fails. */
export async function createDeviceCalendarEvent(
  input: DeviceCalendarEventInput,
): Promise<string> {
  const status = await getAppleCalendarPermissionStatus();
  if (status !== "granted") {
    throw new Error(
      "Apple Calendar is not connected — enable it in Settings → Integrations.",
    );
  }

  const Calendar = await loadCalendarModule();
  const calendarId = await resolveWritableCalendarId(Calendar);
  if (!calendarId) {
    throw new Error("No writable calendar found on this device.");
  }

  const startDate = toDate(input.start);
  const endDate = toDate(input.end);
  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate.getTime() <= startDate.getTime()
  ) {
    throw new Error("Invalid event time range.");
  }

  const nativeId = await Calendar.createEventAsync(calendarId, {
    title: input.title.trim() || "Alfred",
    startDate,
    endDate,
    notes: input.notes?.trim() || undefined,
    location: input.location?.trim() || undefined,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return `${APPLE_EVENT_ID_PREFIX}${nativeId}`;
}

export async function deleteDeviceCalendarEvent(eventId: string): Promise<void> {
  const Calendar = await loadCalendarModule();
  await Calendar.deleteEventAsync(nativeIdFromAppleEventId(eventId));
}

/** Read device events in [start, end] as UpcomingMeeting rows (source=apple). */
export async function listDeviceCalendarEvents(
  start: Date,
  end: Date,
): Promise<UpcomingMeeting[]> {
  const status = await getAppleCalendarPermissionStatus();
  if (status !== "granted") return [];

  try {
    const Calendar = await loadCalendarModule();
    const calendars = await Calendar.getCalendarsAsync(
      Calendar.EntityTypes.EVENT,
    );
    const ids = calendars.map((c) => c.id).filter(Boolean);
    if (ids.length === 0) return [];

    const events = await Calendar.getEventsAsync(ids, start, end);
    return events
      .map((ev): UpcomingMeeting | null => {
        const startIso = toIso(ev.startDate as Date | string);
        const endIso = toIso(ev.endDate as Date | string);
        if (!startIso || !ev.id) return null;
        return {
          id: `${APPLE_EVENT_ID_PREFIX}${ev.id}`,
          title: ev.title?.trim() || "Event",
          start_time: startIso,
          end_time: endIso,
          location: ev.location ?? null,
          attendees: [],
          prep_required: false,
          html_link: null,
          source: "apple",
        };
      })
      .filter((m): m is UpcomingMeeting => m != null)
      .sort(
        (a, b) =>
          new Date(a.start_time ?? 0).getTime() -
          new Date(b.start_time ?? 0).getTime(),
      );
  } catch {
    return [];
  }
}

/** Merge Google + Apple lists. No heavy dedupe in v1. */
export function mergeCalendarMeetings(
  google: UpcomingMeeting[],
  apple: UpcomingMeeting[],
): UpcomingMeeting[] {
  const taggedGoogle = google.map((m) =>
    m.source ? m : { ...m, source: "google" as const },
  );
  return [...taggedGoogle, ...apple].sort(
    (a, b) =>
      new Date(a.start_time ?? 0).getTime() -
      new Date(b.start_time ?? 0).getTime(),
  );
}
