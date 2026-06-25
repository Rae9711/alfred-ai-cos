// Home — greeting, proactive priority, today's schedule, composer. Live /today data.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { type Me, type TodayDashboard, type UpcomingMeeting } from "@albert/shared-types";

import { api } from "@/api/client";
import { CompanionAvatar } from "@/components/CompanionAvatar";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import { ApprovalSheet } from "@/screens/sheets/ApprovalSheet";
import { MeetingPrepSheet } from "@/screens/sheets/MeetingPrepSheet";
import { MeetingDetailSheet } from "@/screens/sheets/MeetingDetailSheet";
import { Btn, Pill, Serif, SerifEm } from "@/components/ui";
import { firstNameOf, greetingFor } from "@/lib/today";
import { greetingForLocale } from "@/i18n/locales";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";

function formatMeetingTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isPast(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < Date.now();
}

export function HomeScreen() {
  const router = useRouter();
  const { openSheet, showToast } = useShell();
  const { meta, state, setThinking } = useCompanionAvatar();
  const { locale, t } = useLocale();
  const { syncAndRefresh } = useMailbox();
  const { setTab } = useWorkflow();

  const [me, setMe] = useState<Me | null>(null);
  const [today, setToday] = useState<TodayDashboard | null>(null);
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [composer, setComposer] = useState("");
  const [asking, setAsking] = useState(false);

  const greeting =
    locale === "zh"
      ? greetingForLocale(new Date().getHours(), locale)
      : greetingFor(new Date().getHours());

  const load = useCallback(async () => {
    const [dashboard, profile, pending, upcoming] = await Promise.all([
      api.getToday(),
      api.getMe().catch(() => null),
      api.listPendingActions(),
      api.listUpcomingMeetings({ today: true }).catch(() => [] as UpcomingMeeting[]),
    ]);
    setToday(dashboard);
    setMe(profile);
    setPendingCount(pending.length);
    setMeetings(upcoming);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setSyncing(true);
    try {
      const [mailResult, calResult] = await Promise.all([
        syncAndRefresh(),
        api.sync({ calendarOnly: true }),
      ]);
      await load();
      const parts: string[] = [];
      if (mailResult > 0) parts.push(`${mailResult} new email${mailResult === 1 ? "" : "s"}`);
      if (calResult.events_synced > 0) {
        parts.push(
          `${calResult.events_synced} calendar event${calResult.events_synced === 1 ? "" : "s"}`,
        );
      }
      if (parts.length > 0) {
        showToast(`Synced ${parts.join(", ")}`);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }, [load, syncAndRefresh, showToast]);

  const top = today?.top_priorities[0] ?? null;
  const proactivePrompt = top?.reason ?? today?.summary ?? t.home.proactiveEmpty;
  const proactiveCta = top ? t.home.proactiveAct : t.home.proactiveInbox;

  const schedule = useMemo(() => meetings.slice(0, 12), [meetings]);

  const submitComposer = () => {
    const q = composer.trim();
    if (!q || asking) return;
    setComposer("");
    setAsking(true);
    setThinking(true);
    void (async () => {
      try {
        const res = await api.ask(q);
        showToast(res.reply, { duration: 6000 });
        if (res.action !== "none") {
          await api.sync({ calendarOnly: true }).catch(() => undefined);
          await load();
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.home.askFailed);
      } finally {
        setAsking(false);
        setThinking(false);
      }
    })();
  };

  const onProactivePress = () => {
    if (top) {
      openSheet(
        <ApprovalSheet
          commitmentId={top.id}
          recipient={top.counterparty ?? "them"}
          onDone={() => void load()}
        />,
      );
      return;
    }
    setTab("inbox");
  };

  const displayName =
    firstNameOf(me?.name) ?? me?.email.split("@")[0] ?? "there";

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={syncing}
            onRefresh={() => void onRefresh()}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Serif size={30}>
              {greeting} <SerifEm>{displayName}</SerifEm>
            </Serif>
          </View>
          <Pressable
            onPress={() => router.push("/search")}
            hitSlop={10}
            style={styles.searchBtn}
            accessibilityLabel="Search"
          >
            <Ic.Search size={18} color={colors.ink3} stroke={1.5} />
          </Pressable>
          <CompanionAvatar
            size={52}
            level={meta.level}
            color={meta.color}
            state={state}
            speech={t.home.speechHi}
          />
        </View>

        {pendingCount > 0 ? (
          <Pressable
            style={styles.approvalsBanner}
            onPress={() => router.push("/approvals")}
          >
            <Text style={styles.approvalsText}>
              {t.home.pendingApprovals(pendingCount)}
            </Text>
            <Ic.Arrow size={16} color={colors.warn} />
          </Pressable>
        ) : null}

        <View style={styles.butlerBlock}>
          <Text style={styles.butlerLabel}>{t.home.butlerLabel}</Text>
          <View style={styles.proactiveCard}>
            <Serif size={17} style={styles.proactiveText}>
              {proactivePrompt}
            </Serif>
            <Btn
              label={proactiveCta}
              onPress={onProactivePress}
              style={styles.proactiveBtn}
            />
          </View>
        </View>


        <Text style={styles.sectionLabel}>{t.home.sectionToday}</Text>
        {schedule.length > 0 ? (
          <View style={styles.schedule}>
            {schedule.map((item) => (
              <ScheduleRow
                key={item.id}
                time={formatMeetingTime(item.start_time)}
                title={item.title ?? "Meeting"}
                past={isPast(item.start_time)}
                detail={
                  item.location?.trim() ||
                  (item.attendees.length
                    ? item.attendees.slice(0, 2).join(", ")
                    : "")
                }
                tag={
                  item.prep_required
                    ? { label: t.home.prepRequired, tone: "accent" as const }
                    : undefined
                }
                onPress={() =>
                  openSheet(
                    <MeetingDetailSheet
                      eventId={item.id}
                      onChanged={() => void load()}
                    />,
                  )
                }
              />
            ))}
          </View>
        ) : (
          <Text style={styles.scheduleEmpty}>{t.home.scheduleEmpty}</Text>
        )}
      </ScrollView>

      <View style={styles.composerBar}>
        <View style={styles.composerInner}>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder={t.home.composerPlaceholder}
            placeholderTextColor={colors.ink4}
            style={styles.composerInput}
            onSubmitEditing={submitComposer}
            editable={!asking}
          />
          <Pressable
            style={styles.micBtn}
            onPress={submitComposer}
            accessibilityLabel={t.a11y.send}
          >
            {asking ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ic.ArrowUp size={16} color={colors.accent} stroke={2} />
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function ScheduleRow({
  time,
  title,
  detail,
  tag,
  past,
  onPress,
}: {
  time: string;
  title: string;
  detail: string;
  tag?: { label: string; tone: "accent" | "warn" | "muted" };
  past?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={[styles.scheduleRow, past && styles.scheduleRowPast]}>
      <Text style={[styles.scheduleTime, past && styles.schedulePast]}>{time}</Text>
      <View style={styles.scheduleBody}>
        <Text style={[styles.scheduleTitle, past && styles.schedulePast]}>{title}</Text>
        {detail ? (
          <Text style={[styles.scheduleDetail, past && styles.schedulePast]}>{detail}</Text>
        ) : null}
        {tag ? (
          <Pill label={tag.label} kind={tag.tone} mono style={styles.scheduleTag} />
        ) : null}
      </View>
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.rowPressed}>
        {body}
      </Pressable>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  headerText: { flex: 1 },
  searchBtn: { paddingTop: 8 },
  butlerBlock: { marginTop: spacing.lg, gap: 8 },
  butlerLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  proactiveCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    padding: spacing.md,
    gap: 14,
  },
  proactiveText: { color: colors.ink2, lineHeight: 24 },
  proactiveBtn: { alignSelf: "flex-start" },
  approvalsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warnSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  approvalsText: {
    flex: 1,
    color: colors.warn,
    fontWeight: "600",
    fontSize: 13,
  },
  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: 10,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  priorityStack: { gap: layout.gapCard },
  schedule: { gap: 0 },
  scheduleEmpty: {
    fontSize: 14,
    color: colors.ink3,
    fontStyle: "italic",
  },
  scheduleRow: {
    flexDirection: "row",
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
  },
  scheduleRowPast: { opacity: 0.55 },
  schedulePast: { color: colors.ink4 },
  rowPressed: { opacity: 0.85 },
  scheduleTime: {
    width: 48,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink3,
    paddingTop: 2,
  },
  scheduleBody: { flex: 1, gap: 4 },
  scheduleTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  scheduleDetail: { fontSize: 14, color: colors.ink3, lineHeight: 20 },
  scheduleTag: { alignSelf: "flex-start", marginTop: 4 },
  composerBar: {
    paddingHorizontal: layout.padX,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
    backgroundColor: colors.paper,
  },
  composerInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
  },
  composerInput: { flex: 1, fontSize: 15, color: colors.ink },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
