// Meeting detail — view, cancel, or open prep for a calendar event.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { type UpcomingMeeting } from "@albert/shared-types";

import { api } from "@/api/client";
import { useShell } from "@/components/Shell";
import { MeetingPrepSheet } from "@/screens/sheets/MeetingPrepSheet";
import { Btn } from "@/components/ui";
import {
  deleteDeviceCalendarEvent,
  isAppleEventId,
} from "@/lib/appleCalendar";
import { colors, fonts, spacing } from "@/theme/theme";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MeetingDetailSheet({
  eventId,
  initialEvent,
  onChanged,
}: {
  eventId: string;
  /** Pass for Apple/device events — no Google API fetch. */
  initialEvent?: UpcomingMeeting;
  onChanged?: () => void;
}) {
  const { closeSheet, openSheet, showToast } = useShell();
  const isApple = isAppleEventId(eventId) || initialEvent?.source === "apple";
  const [event, setEvent] = useState<UpcomingMeeting | null>(
    initialEvent ?? null,
  );
  const [loading, setLoading] = useState(!initialEvent && !isApple);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (isApple) {
      if (initialEvent) setEvent(initialEvent);
      return;
    }
    const data = await api.getMeeting(eventId);
    setEvent({ ...data, source: data.source ?? "google" });
  }, [eventId, initialEvent, isApple]);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Couldn't load event");
      } finally {
        setLoading(false);
      }
    })();
  }, [load, showToast]);

  const onCancel = () => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        if (isApple) {
          await deleteDeviceCalendarEvent(eventId);
        } else {
          await api.deleteMeeting(eventId);
        }
        showToast("Event cancelled");
        onChanged?.();
        closeSheet();
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Cancel failed");
      } finally {
        setBusy(false);
      }
    })();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Event not found</Text>
      </View>
    );
  }

  const sourceLabel =
    event.source === "apple" || isApple
      ? "Apple Calendar"
      : "Google Calendar";

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{event.title ?? "Meeting"}</Text>
      <Text style={styles.when}>{formatWhen(event.start_time)}</Text>
      <Text style={styles.source}>{sourceLabel}</Text>
      {event.location ? <Text style={styles.detail}>{event.location}</Text> : null}
      {event.attendees.length > 0 ? (
        <Text style={styles.detail}>{event.attendees.join(", ")}</Text>
      ) : null}

      {event.html_link ? (
        <Pressable
          onPress={() => void Linking.openURL(event.html_link!)}
          style={styles.linkBtn}
        >
          <Text style={styles.linkText}>Open in Google Calendar</Text>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        {!isApple && event.prep_required ? (
          <Btn
            label="Meeting prep"
            kind="ghost"
            onPress={() => openSheet(<MeetingPrepSheet eventId={eventId} />)}
          />
        ) : null}
        <Btn
          label={busy ? "Cancelling…" : "Cancel event"}
          kind="ghost"
          onPress={onCancel}
          disabled={busy}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: spacing.lg, gap: spacing.sm },
  centered: { padding: spacing.xl, alignItems: "center" },
  title: {
    fontFamily: fonts.serifDisplay,
    fontSize: 22,
    color: colors.ink,
  },
  when: { fontFamily: fonts.sans, fontSize: 14, color: colors.ink2 },
  source: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink3 },
  detail: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink2 },
  muted: { fontFamily: fonts.sans, fontSize: 14, color: colors.ink3 },
  linkBtn: { paddingVertical: 8 },
  linkText: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.blue700,
  },
  actions: { marginTop: spacing.md, gap: spacing.sm },
});
