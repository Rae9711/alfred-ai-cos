// Meeting detail — view, cancel, or open prep for a calendar event.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { type UpcomingMeeting } from "@albert/shared-types";

import { api } from "@/api/client";
import { useShell } from "@/components/Shell";
import { MeetingPrepSheet } from "@/screens/sheets/MeetingPrepSheet";
import { Btn } from "@/components/ui";
import { colors, fonts, radius, spacing } from "@/theme/theme";

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
  onChanged,
}: {
  eventId: string;
  onChanged?: () => void;
}) {
  const { closeSheet, openSheet, showToast } = useShell();
  const [event, setEvent] = useState<UpcomingMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const data = await api.getMeeting(eventId);
    setEvent(data);
  }, [eventId]);

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
        await api.deleteMeeting(eventId);
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

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{event.title ?? "Meeting"}</Text>
      <Text style={styles.when}>{formatWhen(event.start_time)}</Text>
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
        {event.prep_required ? (
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
  root: { padding: spacing.md, gap: spacing.sm },
  centered: {
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "600", color: colors.ink },
  when: { fontFamily: fonts.mono, fontSize: 13, color: colors.ink3 },
  detail: { fontSize: 14, color: colors.ink2, lineHeight: 20 },
  muted: { color: colors.ink3 },
  linkBtn: { marginTop: spacing.xs },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: "500" },
  actions: { marginTop: spacing.md, gap: spacing.sm },
});
