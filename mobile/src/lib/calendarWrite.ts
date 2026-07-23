/**
 * Primary write calendar: Google | Apple. Reads merge both; writes go to one.
 * Preference is stored locally and synced to user.preferences.calendar_write_primary.
 */
import type { Me } from "@albert/shared-types";

import { api } from "@/api/client";
import {
  createDeviceCalendarEvent,
  getAppleCalendarPermissionStatus,
  type DeviceCalendarEventInput,
} from "@/lib/appleCalendar";
import {
  deleteSecureItem,
  readSecureItem,
  writeSecureItem,
} from "@/lib/secureStorage";

export type CalendarWritePrimary = "google" | "apple";

const STORAGE_KEY = "alfred.calendar_write_primary";

export type ResolvePrimaryResult = {
  primary: CalendarWritePrimary | null;
  /** Set when we fell back because preferred target was unavailable. */
  fellBackFrom?: CalendarWritePrimary;
  reason?: string;
};

function asPrimary(value: unknown): CalendarWritePrimary | null {
  return value === "google" || value === "apple" ? value : null;
}

export async function getStoredCalendarWritePrimary(): Promise<CalendarWritePrimary | null> {
  try {
    return asPrimary(await readSecureItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function setCalendarWritePrimary(
  primary: CalendarWritePrimary,
): Promise<void> {
  await writeSecureItem(STORAGE_KEY, primary);
  try {
    await api.setCalendarWritePrimary(primary);
  } catch {
    // Local preference still applies for device writes; sync can retry later.
  }
}

export async function clearCalendarWritePrimary(): Promise<void> {
  await deleteSecureItem(STORAGE_KEY);
}

export async function hydrateCalendarWritePrimaryFromMe(
  me: Me | null | undefined,
): Promise<CalendarWritePrimary | null> {
  const fromServer = asPrimary(me?.preferences?.["calendar_write_primary"]);
  if (fromServer) {
    await writeSecureItem(STORAGE_KEY, fromServer);
    return fromServer;
  }
  return getStoredCalendarWritePrimary();
}

export async function resolveCalendarWritePrimary(opts: {
  googleConnected: boolean;
  appleGranted?: boolean;
}): Promise<ResolvePrimaryResult> {
  const appleGranted =
    opts.appleGranted ??
    (await getAppleCalendarPermissionStatus()) === "granted";
  const googleOk = opts.googleConnected;
  const appleOk = appleGranted;

  const preferred = await getStoredCalendarWritePrimary();

  if (preferred === "google") {
    if (googleOk) return { primary: "google" };
    if (appleOk) {
      return {
        primary: "apple",
        fellBackFrom: "google",
        reason:
          "Google Calendar isn’t connected — new events will go to Apple Calendar. Reconnect Google or change Default calendar in Settings.",
      };
    }
    return {
      primary: null,
      reason:
        "Google Calendar isn’t connected. Reconnect Google or enable Apple Calendar in Settings.",
    };
  }

  if (preferred === "apple") {
    if (appleOk) return { primary: "apple" };
    if (googleOk) {
      return {
        primary: "google",
        fellBackFrom: "apple",
        reason:
          "Apple Calendar isn’t available — new events will go to Google. Enable Apple Calendar or change Default calendar in Settings.",
      };
    }
    return {
      primary: null,
      reason:
        "Apple Calendar isn’t connected. Enable it in Settings, or connect Google.",
    };
  }

  // Default: Google if connected, else Apple if granted.
  if (googleOk) return { primary: "google" };
  if (appleOk) return { primary: "apple" };
  return {
    primary: null,
    reason:
      "Connect Google Calendar or enable Apple Calendar in Settings before booking.",
  };
}

export type BookOnPrimaryResult = {
  target: CalendarWritePrimary;
  eventId?: string | null;
  fallbackNotice?: string;
};

/**
 * Write a new event to the user's primary calendar only (never dual-write).
 * `googleBook` should call the existing Alfred/Google booking API.
 */
export async function bookOnPrimaryCalendar(
  input: DeviceCalendarEventInput,
  opts: {
    googleConnected: boolean;
    googleBook: () => Promise<{ eventId?: string | null } | void>;
  },
): Promise<BookOnPrimaryResult> {
  const resolved = await resolveCalendarWritePrimary({
    googleConnected: opts.googleConnected,
  });
  if (!resolved.primary) {
    throw new Error(resolved.reason ?? "No calendar available to write to.");
  }

  if (resolved.primary === "apple") {
    const eventId = await createDeviceCalendarEvent(input);
    return {
      target: "apple",
      eventId,
      fallbackNotice: resolved.reason,
    };
  }

  const result = await opts.googleBook();
  return {
    target: "google",
    eventId: result && "eventId" in result ? result.eventId : null,
    fallbackNotice: resolved.reason,
  };
}
