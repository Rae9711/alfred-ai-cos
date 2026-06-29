// Home — greeting, next-schedule reminder, today's schedule, composer.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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
import { MeetingPrepSheet } from "@/screens/sheets/MeetingPrepSheet";
import { MeetingDetailSheet } from "@/screens/sheets/MeetingDetailSheet";
import { Btn, Pill, Serif, SerifEm } from "@/components/ui";
import { DayScheduleView } from "@/components/schedule/DayScheduleView";
import { PlanningSuggestionsCard } from "@/components/PlanningSuggestionsCard";
import { MonthScheduleView } from "@/components/schedule/MonthScheduleView";
import { WeekScheduleView } from "@/components/schedule/WeekScheduleView";
import { firstNameOf, greetingFor } from "@/lib/today";
import {
  type ScheduleView,
} from "@/lib/schedule";
import { greetingForLocale } from "@/i18n/locales";
import { parseSmsComposeIntent } from "@/lib/smsComposeIntent";
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
  const { openFreeChat } = useWorkflow();

  const [me, setMe] = useState<Me | null>(null);
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const [todayData, setTodayData] = useState<TodayDashboard | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [composer, setComposer] = useState("");
  const [asking, setAsking] = useState(false);

  const [scheduleView, setScheduleView] = useState<ScheduleView>("day");
  const [selectedMonthDay, setSelectedMonthDay] = useState<Date | null>(null);

  const greeting =
    locale === "zh"
      ? greetingForLocale(new Date().getHours(), locale)
      : greetingFor(new Date().getHours());

  const load = useCallback(async (view: ScheduleView) => {
    try {
      const [profile, pending, upcoming, today] = await Promise.all([
        api.getMe().catch(() => null),
        api.listPendingActions(),
        api.listUpcomingMeetings(
          view === "day"
            ? { today: true }
            : view === "week"
              ? { week: true }
              : { month: true },
        ),
        view === "day" ? api.getToday().catch(() => null) : Promise.resolve(null),
      ]);
      setMe(profile);
      setPendingCount(pending.length);
      setMeetings(upcoming);
      setTodayData(today);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.home.askFailed);
      setMeetings([]);
    }
  }, [showToast, t.home.askFailed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await api.sync({ calendarOnly: true }).catch(() => undefined);
        if (!cancelled) await load(scheduleView);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, scheduleView]);

  const onScheduleViewChange = (view: ScheduleView) => {
    setScheduleView(view);
    setSelectedMonthDay(null);
  };

  const onRefresh = useCallback(async () => {
    setSyncing(true);
    try {
      const [mailResult, calResult] = await Promise.all([
        syncAndRefresh(),
        api.sync({ calendarOnly: true }),
      ]);
      await load(scheduleView);
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
  }, [load, scheduleView, syncAndRefresh, showToast]);

  const today = useMemo(() => new Date(), []);
  const openMeeting = useCallback(
    (item: UpcomingMeeting) => {
      openSheet(
        <MeetingDetailSheet
          eventId={item.id}
          onChanged={() => void load(scheduleView)}
        />,
      );
    },
    [load, openSheet, scheduleView],
  );

  const monthTitle = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    [],
  );

  const scheduleSectionLabel =
    scheduleView === "day"
      ? t.home.sectionToday
      : scheduleView === "week"
        ? t.home.sectionWeek
        : monthTitle;

  const nextMeeting = useMemo(
    () => meetings.find((m) => !isPast(m.start_time)) ?? null,
    [meetings],
  );

  const butlerPrompt = nextMeeting
    ? t.home.nextScheduleReminder(
        formatMeetingTime(nextMeeting.start_time),
        nextMeeting.title ?? t.home.untitledMeeting,
      )
    : meetings.length > 0
      ? t.home.scheduleDoneForDay
      : t.home.noScheduleToday;

  const butlerCta = nextMeeting
    ? nextMeeting.prep_required
      ? t.home.viewPrep
      : t.home.viewSchedule
    : null;

  const submitComposer = () => {
    const q = composer.trim();
    if (!q || asking) return;
    setComposer("");

    const smsIntent = parseSmsComposeIntent(q);
    if (smsIntent) {
      openFreeChat(q);
      return;
    }

    setAsking(true);
    setThinking(true);
    void (async () => {
      try {
        const res = await api.ask(q);
        showToast(res.reply, { duration: 6000 });
        if (res.action !== "none") {
          await api.sync({ calendarOnly: true }).catch(() => undefined);
          await load(scheduleView);
        }
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.home.askFailed);
      } finally {
        setAsking(false);
        setThinking(false);
      }
    })();
  };

  const onButlerPress = () => {
    if (!nextMeeting) return;
    if (nextMeeting.prep_required) {
      openSheet(<MeetingPrepSheet eventId={nextMeeting.id} />);
      return;
    }
    openSheet(
      <MeetingDetailSheet eventId={nextMeeting.id} onChanged={() => void load(scheduleView)} />,
    );
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? layout.tabBarInset : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
              {butlerPrompt}
            </Serif>
            {butlerCta ? (
              <Btn
                label={butlerCta}
                onPress={onButlerPress}
                style={styles.proactiveBtn}
              />
            ) : null}
          </View>
        </View>

        {scheduleView === "day" ? (
          <PlanningSuggestionsCard
            data={todayData}
            onChanged={() => void load(scheduleView)}
          />
        ) : null}

        <View style={styles.scheduleHeader}>
          <Text style={styles.sectionLabel}>{scheduleSectionLabel}</Text>
          <View style={styles.scheduleToggle}>
            {(["day", "week", "month"] as const).map((view) => (
              <Pill
                key={view}
                label={t.home.scheduleViews[view]}
                kind={scheduleView === view ? "accent" : "muted"}
                mono={false}
                onPress={() => onScheduleViewChange(view)}
                style={styles.scheduleTogglePill}
              />
            ))}
          </View>
        </View>

        {scheduleView === "day" ? (
          meetings.length > 0 ? (
            <DayScheduleView
              day={today}
              meetings={meetings}
              onEventPress={openMeeting}
            />
          ) : (
            <Text style={styles.scheduleEmpty}>{t.home.scheduleEmpty}</Text>
          )
        ) : null}

        {scheduleView === "week" ? (
          <WeekScheduleView
            meetings={meetings}
            onEventPress={openMeeting}
            emptyText={t.home.scheduleWeekEmpty}
          />
        ) : null}

        {scheduleView === "month" ? (
          <MonthScheduleView
            meetings={meetings}
            selectedDay={selectedMonthDay}
            onSelectDay={setSelectedMonthDay}
            onEventPress={openMeeting}
          />
        ) : null}
      </ScrollView>

      <View style={styles.composerBar}>
        <View style={styles.composerInner}>
          <TextInput
            value={composer}
            onChangeText={setComposer}
            placeholder={t.home.composerPlaceholder}
            placeholderTextColor={colors.ink4}
            style={styles.composerInput}
            multiline
            maxLength={500}
            returnKeyType="send"
            blurOnSubmit
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
    </KeyboardAvoidingView>
  );
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
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  scheduleHeader: {
    marginTop: spacing.lg,
    marginBottom: 10,
    gap: 10,
  },
  scheduleToggle: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scheduleTogglePill: { marginRight: 0 },
  scheduleEmpty: {
    fontSize: 14,
    color: colors.ink3,
    fontStyle: "italic",
  },
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
    alignItems: "flex-end",
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 22,
    paddingVertical: 8,
    paddingLeft: 14,
    paddingRight: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    minHeight: 44,
  },
  composerInput: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    minHeight: 28,
    maxHeight: 100,
    paddingVertical: 4,
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
