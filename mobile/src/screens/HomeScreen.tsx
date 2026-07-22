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
import { useFocusEffect, useRouter } from "expo-router";
import {
  type Me,
  type Task,
  TaskStatus,
  CommitmentStatus,
  type TodayDashboard,
  type UpcomingMeeting,
  type ConversationInboxItem,
  type InboxMessage,
} from "@albert/shared-types";

import { api } from "@/api/client";
import AlfredMiniAvatar from "@/components/AlfredMiniAvatar";
import { AlfredIcon } from "@/components/AlfredIcon";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import { MeetingPrepSheet } from "@/screens/sheets/MeetingPrepSheet";
import { MeetingDetailSheet } from "@/screens/sheets/MeetingDetailSheet";
import { ScreenWash } from "@/components/ScreenWash";
import { Btn, Disclose, Pill, Serif, SerifEm } from "@/components/ui";
import { DayScheduleView } from "@/components/schedule/DayScheduleView";
import { PlanningSuggestionsCard } from "@/components/PlanningSuggestionsCard";
import { MonthScheduleView } from "@/components/schedule/MonthScheduleView";
import { WeekScheduleView } from "@/components/schedule/WeekScheduleView";
import { firstNameOf, greetingFor } from "@/lib/today";
import { parseSenderDisplay } from "@/lib/inbox";
import {
  type ScheduleView,
  buildDayTimelineItems,
} from "@/lib/schedule";
import { greetingForLocale } from "@/i18n/locales";
import { parseSmsComposeIntent } from "@/lib/smsComposeIntent";
import {
  cancelLocalTaskReminder,
  scheduleFromAssistantResponse,
  syncLocalRemindersForTasks,
} from "@/lib/taskReminders";
import { surfaces } from "@/theme/surfaces";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";

function formatInboxTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Dimensional calendar well with today's date badge (design sheet). */
function CalendarDateIcon({ day }: { day: number }) {
  return (
    <View style={calDateStyles.wrap}>
      <AlfredIcon icon={Ic.CalendarFill} variant="dimensional" size="medium" />
      <View style={calDateStyles.badge}>
        <Text style={calDateStyles.day}>{day}</Text>
      </View>
    </View>
  );
}

const calDateStyles = StyleSheet.create({
  wrap: { position: "relative" },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -2,
    minWidth: 20,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: colors.blue700,
    alignItems: "center",
    justifyContent: "center",
  },
  day: {
    fontFamily: fonts.sansSemibold,
    fontSize: 10,
    lineHeight: 12,
    color: "#FFFFFF",
  },
});

function formatReminderWhen(task: Task): string {
  if (task.remind_at) {
    return new Date(task.remind_at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (task.due_date) {
    return new Date(`${task.due_date}T12:00:00`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return "—";
}

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
  const { setThinking, flashState } = useCompanionAvatar();
  const { locale, t } = useLocale();
  const { syncAndRefresh } = useMailbox();
  const { openAlfred, openConfirmReply, setTab } = useWorkflow();

  const [me, setMe] = useState<Me | null>(null);
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const [todayData, setTodayData] = useState<TodayDashboard | null>(null);
  const [reminders, setReminders] = useState<Task[]>([]);
  const [conversationItems, setConversationItems] = useState<ConversationInboxItem[]>([]);
  const [conversationCounts, setConversationCounts] = useState<Record<string, number>>({});
  const [homeInbox, setHomeInbox] = useState<InboxMessage[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [composer, setComposer] = useState("");
  const [asking, setAsking] = useState(false);
  const [scheduleAction, setScheduleAction] = useState(false);
  const [habitAction, setHabitAction] = useState(false);

  const [scheduleView, setScheduleView] = useState<ScheduleView>("day");
  const [selectedMonthDay, setSelectedMonthDay] = useState<Date | null>(null);

  const greeting =
    locale === "zh"
      ? greetingForLocale(new Date().getHours(), locale)
      : greetingFor(new Date().getHours());

  const load = useCallback(async (view: ScheduleView) => {
    try {
      const [profile, pending, upcoming, today, upcomingReminders, conversationInbox, inboxView] =
        await Promise.all([
          api.getMe().catch(() => null),
          api.listPendingActions(),
          api.listUpcomingMeetings(
            view === "day"
              ? { today: true }
              : view === "week"
                ? { week: true }
                : { month: true },
          ),
          view === "day" ? api.getToday(locale).catch(() => null) : Promise.resolve(null),
          view === "day"
            ? api.listTasks({ upcoming: true }).catch(() => [] as Task[])
            : Promise.resolve([] as Task[]),
          api.getConversationInbox().catch(() => ({ items: [], counts: {} })),
          api
            .getInbox({ scope: "needs_action" })
            .catch(() => ({ messages: [], filtered_count: 0, mailboxes: [] })),
        ]);
      setMe(profile);
      setPendingCount(pending.length);
      setMeetings(upcoming);
      setTodayData(today);
      setReminders(upcomingReminders);
      setHomeInbox(Array.isArray(inboxView?.messages) ? inboxView.messages.slice(0, 3) : []);
      setConversationItems(
        Array.isArray(conversationInbox?.items) ? conversationInbox.items : [],
      );
      setConversationCounts(
        conversationInbox?.counts &&
          typeof conversationInbox.counts === "object" &&
          !Array.isArray(conversationInbox.counts)
          ? (conversationInbox.counts as Record<string, number>)
          : {},
      );
      if (upcomingReminders.length > 0) {
        void syncLocalRemindersForTasks(upcomingReminders);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : t.home.askFailed);
      setMeetings([]);
    }
  }, [locale, showToast, t.home.askFailed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await Promise.all([
          api.sync({ ingestOnly: true }).catch(() => undefined),
          api.sync({ calendarOnly: true }).catch(() => undefined),
        ]);
        if (!cancelled) await load(scheduleView);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, scheduleView]);

  useFocusEffect(
    useCallback(() => {
      if (loading) return;
      void load(scheduleView);
    }, [load, loading, scheduleView]),
  );

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
  const dayTimelineItems = useMemo(
    () => buildDayTimelineItems(meetings, reminders, today),
    [meetings, reminders, today],
  );
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

  const topScheduleProposal = todayData?.schedule_proposals?.[0] ?? null;
  const topHabitSuggestion = todayData?.habit_suggestions?.[0] ?? null;
  const weekAhead = todayData?.week_ahead ?? null;
  const proposalConflict = topScheduleProposal?.conflicts?.[0] ?? null;

  const formatScheduleWhen = (iso: string) =>
    new Date(iso).toLocaleString(locale === "zh" ? "zh-CN" : undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const butlerPrompt = topScheduleProposal
    ? proposalConflict
      ? `${t.home.scheduleProposalPrompt(
          topScheduleProposal.counterparty ?? t.home.untitledMeeting,
          topScheduleProposal.title,
          formatScheduleWhen(topScheduleProposal.start_time),
        )} ${t.home.scheduleProposalConflict(proposalConflict.title)}`
      : t.home.scheduleProposalPrompt(
          topScheduleProposal.counterparty ?? t.home.untitledMeeting,
          topScheduleProposal.title,
          formatScheduleWhen(topScheduleProposal.start_time),
        )
    : topHabitSuggestion
      ? topHabitSuggestion.prompt
    : nextMeeting
    ? t.home.nextScheduleReminder(
        formatMeetingTime(nextMeeting.start_time),
        nextMeeting.title ?? t.home.untitledMeeting,
      )
    : meetings.length > 0
      ? t.home.scheduleDoneForDay
      : t.home.noScheduleToday;

  const butlerCta = topScheduleProposal
    ? null
    : topHabitSuggestion
      ? t.home.habitBlockCta
    : nextMeeting
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
      // SMS compose is an Alfred hub capability, not Chats.
      openAlfred({ text: q, mode: "sms" });
      return;
    }

    setAsking(true);
    setThinking(true);
    void (async () => {
      try {
        const res = await api.ask(q);
        await scheduleFromAssistantResponse(res);
        showToast(res.reply, { duration: 6000 });
        if (res.action !== "none") {
          flashState("success");
          await api.sync({ calendarOnly: true }).catch(() => undefined);
          await load(scheduleView);
        }
        if (res.action === "created") {
          const upcoming = await api.listTasks({ upcoming: true }).catch(() => [] as Task[]);
          setReminders(upcoming);
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
    if (topHabitSuggestion) {
      if (habitAction) return;
      setHabitAction(true);
      void (async () => {
        try {
          await api.schedulePlanningBlock({
            title: topHabitSuggestion.activity,
            start: topHabitSuggestion.suggested_start,
            end: topHabitSuggestion.suggested_end,
          });
          showToast(t.home.habitBlockScheduled);
          flashState("success");
          await api.sync({ calendarOnly: true }).catch(() => undefined);
          await load(scheduleView);
        } catch (e) {
          showToast(e instanceof Error ? e.message : t.home.habitBlockFailed);
        } finally {
          setHabitAction(false);
        }
      })();
      return;
    }
    if (!nextMeeting) return;
    if (nextMeeting.prep_required) {
      openSheet(<MeetingPrepSheet eventId={nextMeeting.id} />);
      return;
    }
    openSheet(
      <MeetingDetailSheet eventId={nextMeeting.id} onChanged={() => void load(scheduleView)} />,
    );
  };

  const confirmScheduleReply = useCallback(() => {
    if (!topScheduleProposal) return;
    const body = locale === "zh" ? "好的" : "Sounds good";
    openConfirmReply(topScheduleProposal.source_message_id, body);
  }, [locale, openConfirmReply, topScheduleProposal]);

  const acceptScheduleProposal = useCallback(() => {
    if (!topScheduleProposal || scheduleAction) return;
    setScheduleAction(true);
    void (async () => {
      try {
        await api.acceptScheduleProposal(topScheduleProposal.id);
        showToast(t.home.scheduleProposalAccepted);
        flashState("success");
        await api.sync({ calendarOnly: true }).catch(() => undefined);
        await load(scheduleView);
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.home.scheduleProposalFailed);
      } finally {
        setScheduleAction(false);
      }
    })();
  }, [
    load,
    scheduleAction,
    scheduleView,
    showToast,
    t.home.scheduleProposalAccepted,
    t.home.scheduleProposalFailed,
    topScheduleProposal,
  ]);

  const dismissScheduleProposal = useCallback(() => {
    if (!topScheduleProposal || scheduleAction) return;
    setScheduleAction(true);
    void (async () => {
      try {
        await api.dismissScheduleProposal(topScheduleProposal.id);
        await load(scheduleView);
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.home.scheduleProposalFailed);
      } finally {
        setScheduleAction(false);
      }
    })();
  }, [load, scheduleAction, scheduleView, showToast, t.home.scheduleProposalFailed, topScheduleProposal]);

  const dismissHabitSuggestion = useCallback(() => {
    if (!topHabitSuggestion || habitAction) return;
    setHabitAction(true);
    void (async () => {
      try {
        await api.dismissHabitSuggestion(topHabitSuggestion.habit_id);
        await load(scheduleView);
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.home.habitBlockFailed);
      } finally {
        setHabitAction(false);
      }
    })();
  }, [
    habitAction,
    load,
    scheduleView,
    showToast,
    t.home.habitBlockFailed,
    topHabitSuggestion,
  ]);

  const completeReminder = useCallback(
    (task: Task) => {
      void (async () => {
        try {
          await api.updateTaskStatus(task.id, TaskStatus.Done);
          await cancelLocalTaskReminder(task.id);
          setReminders((rows) => rows.filter((r) => r.id !== task.id));
          showToast(`Done: ${task.title}`);
          flashState("success");
          await load(scheduleView);
        } catch (e) {
          showToast(e instanceof Error ? e.message : t.home.askFailed);
        }
      })();
    },
    [load, scheduleView, showToast, t.home.askFailed],
  );

  const onTimelineTaskPress = useCallback(
    (taskId: string) => {
      const task = reminders.find((row) => row.id === taskId);
      if (task) completeReminder(task);
    },
    [completeReminder, reminders],
  );

  const removeConversationItem = useCallback((item: ConversationInboxItem) => {
    setConversationItems((rows) =>
      (Array.isArray(rows) ? rows : []).filter(
        (r) => !(r.id === item.id && r.kind === item.kind),
      ),
    );
  }, []);

  const resolveConversationItem = useCallback(
    async (
      item: ConversationInboxItem,
      status: "done" | "dismissed",
      opts?: { silent?: boolean },
    ) => {
      try {
        if (item.kind === "task") {
          await api.updateTaskStatus(item.id, TaskStatus.Done);
          await cancelLocalTaskReminder(item.id);
        } else {
          await api.updateCommitmentStatus(
            item.id,
            status === "done" ? CommitmentStatus.Done : CommitmentStatus.Dismissed,
          );
        }
        removeConversationItem(item);
        if (!opts?.silent) {
          showToast(
            status === "done" ? t.home.followUpMarkedDone : t.home.followUpIgnored,
          );
          flashState("success");
        }
        await load(scheduleView);
        return true;
      } catch {
        showToast(t.home.followUpUpdateFailed);
        return false;
      }
    },
    [
      flashState,
      load,
      removeConversationItem,
      scheduleView,
      showToast,
      t.home.followUpIgnored,
      t.home.followUpMarkedDone,
      t.home.followUpUpdateFailed,
    ],
  );

  const addConversationToCalendar = useCallback(
    async (item: ConversationInboxItem) => {
      try {
        const evidence = item.evidence ? ` Context: ${item.evidence}` : "";
        const res = await api.ask(
          `Add this to my calendar: ${item.title}.${evidence}`,
        );
        if (res.action === "booked" || res.action === "created" || res.action === "updated") {
          const resolved = await resolveConversationItem(item, "done", { silent: true });
          if (resolved) {
            showToast(t.home.followUpCalendarOk);
            flashState("success");
          }
        } else {
          showToast(res.reply || t.home.followUpCalendarFailed);
        }
      } catch {
        showToast(t.home.followUpCalendarFailed);
      }
    },
    [
      flashState,
      resolveConversationItem,
      showToast,
      t.home.followUpCalendarFailed,
      t.home.followUpCalendarOk,
    ],
  );

  const displayName =
    firstNameOf(me?.name) ?? me?.email.split("@")[0] ?? "there";

  const summaryTitle =
    meetings.length === 0
      ? t.home.noScheduleToday.replace(/\.$/, "")
      : nextMeeting
        ? t.home.nextScheduleReminder(
            formatMeetingTime(nextMeeting.start_time),
            nextMeeting.title ?? t.home.untitledMeeting,
          )
        : t.home.scheduleDoneForDay.replace(/\.$/, "");

  const summarySubtitle =
    todayData?.day_overview?.trim() ||
    (meetings.length === 0
      ? t.home.focusTimeAvailable
      : butlerPrompt);

  // Design sheet micro-label: THURSDAY · JULY 22 (English uppercase tracking).
  const eyebrowDate = today
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    .toUpperCase()
    .replace(",", " ·");

  if (loading) {
    return (
      <View style={styles.centered}>
        <ScreenWash />
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
      <ScreenWash />
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
        <View style={styles.topBar}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrowDate}>{eyebrowDate}</Text>
            <Serif size={31} display style={styles.greeting}>
              {greeting}{" "}
              <SerifEm>{displayName}</SerifEm>
            </Serif>
            <Text style={styles.greetingDesc} numberOfLines={2}>
              {todayData?.day_overview?.trim() || t.home.greetingReady}
            </Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              style={surfaces.roundButton}
              onPress={() => router.push("/approvals")}
              accessibilityLabel="Notifications"
            >
              <Ic.Bell size={18} color="#4B5C7C" stroke={2} />
              {pendingCount > 0 ? (
                <View style={styles.bellDot} />
              ) : null}
            </Pressable>
            <AlfredMiniAvatar size={88} accessibilityLabel="Alfred" />
          </View>
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

        <Pressable
          style={styles.dailySummary}
          onPress={() => {
            if (nextMeeting) onButlerPress();
            else setTab("today");
          }}
        >
          <CalendarDateIcon day={today.getDate()} />
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryTitle} numberOfLines={2}>
              {summaryTitle}
            </Text>
            <Text style={styles.summarySub} numberOfLines={2}>
              {summarySubtitle}
            </Text>
          </View>
          <Ic.Arrow size={18} color={colors.ink4} />
        </Pressable>

        {(topScheduleProposal || topHabitSuggestion) &&
        !(todayData?.suggestions?.length) ? (
          <View style={styles.butlerBlock}>
            <View style={styles.proactiveCard}>
              <Serif size={18} style={styles.proactiveText}>
                {butlerPrompt}
              </Serif>
              {topHabitSuggestion && !topScheduleProposal ? (
                <Text style={styles.habitPattern}>
                  {topHabitSuggestion.pattern_summary}
                </Text>
              ) : null}
              {topHabitSuggestion && !topScheduleProposal ? (
                <View style={styles.habitActions}>
                  <Btn
                    label={butlerCta ?? t.home.habitBlockCta}
                    onPress={onButlerPress}
                    style={styles.proactiveBtn}
                    disabled={habitAction}
                  />
                  <Pressable
                    onPress={dismissHabitSuggestion}
                    disabled={habitAction}
                    hitSlop={8}
                  >
                    <Text style={styles.dismissProposal}>
                      {t.home.dismissProposal}
                    </Text>
                  </Pressable>
                </View>
              ) : butlerCta ? (
                <Btn
                  label={butlerCta}
                  onPress={onButlerPress}
                  style={styles.proactiveBtn}
                  disabled={habitAction}
                />
              ) : null}
              {topScheduleProposal ? (
                <View style={styles.scheduleProposalActions}>
                  <Btn
                    label={t.home.addToCalendar}
                    onPress={acceptScheduleProposal}
                    style={styles.proactiveBtn}
                    disabled={scheduleAction}
                  />
                  <Btn
                    label={t.home.replyConfirm(
                      topScheduleProposal.counterparty ?? t.home.untitledMeeting,
                    )}
                    onPress={confirmScheduleReply}
                    style={styles.proactiveBtn}
                    kind="ghost"
                    disabled={scheduleAction}
                  />
                  <Pressable
                    onPress={dismissScheduleProposal}
                    disabled={scheduleAction}
                    hitSlop={8}
                  >
                    <Text style={styles.dismissProposal}>
                      {t.home.dismissProposal}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {scheduleView === "day" ? (
          <PlanningSuggestionsCard
            data={todayData}
            onChanged={() => void load(scheduleView)}
          />
        ) : null}

        {weekAhead ? (
          <Disclose
            style={styles.discloseBlock}
            label={t.home.showWeekAhead}
            labelExpanded={t.home.hideWeekAhead}
            defaultOpen={Boolean(weekAhead.show_prominently)}
          >
            <Text style={styles.weekAheadText}>{weekAhead.summary}</Text>
          </Disclose>
        ) : null}

        {reminders.length > 0 ? (
          <Disclose
            style={styles.discloseBlock}
            label={t.home.showReminders(reminders.length)}
            labelExpanded={t.home.hideReminders}
          >
            {reminders.slice(0, 5).map((task) => (
              <Pressable
                key={task.id}
                style={styles.reminderRow}
                onPress={() => completeReminder(task)}
                accessibilityLabel={`${task.title}, tap to mark done`}
              >
                <Text style={styles.reminderTitle} numberOfLines={1}>
                  {task.title}
                </Text>
                <Text style={styles.reminderWhen}>
                  {task.remind_at
                    ? t.home.reminderAt(formatReminderWhen(task))
                    : t.home.reminderDue(formatReminderWhen(task))}
                </Text>
              </Pressable>
            ))}
          </Disclose>
        ) : null}

        {conversationItems.length > 0 ? (
          <Disclose
            style={styles.discloseBlock}
            label={t.home.showFollowUps(conversationItems.length)}
            labelExpanded={t.home.hideFollowUps}
          >
            <View style={styles.conversationCard}>
              <Text style={styles.conversationSummary}>
                {t.home.fromConversationsSummary(
                  conversationCounts.tasks ?? 0,
                  conversationCounts.follow_ups ?? 0,
                  conversationCounts.commitments ?? 0,
                )}
              </Text>
              {conversationItems.slice(0, 5).map((item) => (
                <View key={`${item.kind}-${item.id}`} style={styles.conversationRow}>
                  <Text style={styles.conversationKind}>
                    {item.kind === "calendar_event"
                      ? "·"
                      : item.kind === "follow_up"
                        ? "↻"
                        : "□"}
                  </Text>
                  <View style={styles.conversationBody}>
                    <Text style={styles.conversationTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.conversationMeta} numberOfLines={1}>
                      {item.evidence
                        ? t.home.conversationEvidence(item.evidence)
                        : item.source_label || t.home.conversationSource}
                    </Text>
                    <View style={styles.conversationActions}>
                      <Pressable
                        onPress={() => void addConversationToCalendar(item)}
                        hitSlop={6}
                      >
                        <Text style={styles.conversationActionAccent}>
                          {t.home.followUpAddCalendar}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void resolveConversationItem(item, "dismissed")}
                        hitSlop={6}
                      >
                        <Text style={styles.conversationActionMuted}>
                          {t.home.followUpIgnore}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void resolveConversationItem(item, "done")}
                        hitSlop={6}
                      >
                        <Text style={styles.conversationActionMuted}>
                          {t.home.followUpDone}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </Disclose>
        ) : null}

        {/* Design sheet first viewport: inbox on Home (not day/week/month). */}
        <View style={styles.inboxSection}>
          <View style={styles.inboxHeader}>
            <View>
              <Text style={styles.sectionLabel}>{t.home.inboxNeedsYou}</Text>
              <Text style={styles.inboxTitle}>{t.home.inboxTitle}</Text>
            </View>
            <Pressable
              style={styles.viewAllBtn}
              onPress={() => setTab("inbox")}
              hitSlop={8}
            >
              <Text style={styles.viewAllText}>{t.home.viewAll}</Text>
              <Ic.Arrow size={16} color={colors.ink3} />
            </Pressable>
          </View>

          <View style={styles.emailCard}>
            {homeInbox.length === 0 ? (
              <Text style={styles.inboxEmpty}>{t.inbox.inboxZero}</Text>
            ) : (
              homeInbox.map((msg, index) => {
                const sender = parseSenderDisplay(msg.sender);
                const done = Boolean(msg.user_decided || msg.user_replied);
                return (
                  <Pressable
                    key={msg.id}
                    style={styles.emailRow}
                    onPress={() => setTab("inbox")}
                  >
                    <View style={styles.senderAvatar}>
                      <Text style={styles.senderInitial}>
                        {(sender.charAt(0) || "?").toUpperCase()}
                      </Text>
                      {!done ? <View style={styles.senderStatus} /> : null}
                    </View>
                    <View style={styles.emailContent}>
                      <View style={styles.emailMeta}>
                        <Text style={styles.emailSender} numberOfLines={1}>
                          {sender}
                        </Text>
                        <Text style={styles.emailTime}>
                          {formatInboxTime(msg.sent_at)}
                        </Text>
                      </View>
                      <Text style={styles.emailSubject} numberOfLines={1}>
                        {msg.subject?.trim() || "(No subject)"}
                      </Text>
                      <Text style={styles.emailPreview} numberOfLines={2}>
                        {msg.snippet?.trim() || msg.take?.trim() || ""}
                      </Text>
                    </View>
                    <View
                      style={[
                        surfaces.statusPill,
                        done && styles.statusDonePill,
                      ]}
                    >
                      <Text
                        style={[
                          surfaces.statusPillText,
                          done && styles.statusDoneText,
                        ]}
                      >
                        {done ? t.home.statusDone : t.home.statusNeedsAction}
                      </Text>
                    </View>
                    {index < homeInbox.length - 1 ? (
                      <View style={styles.emailDivider} />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </View>
        </View>

        {/* Day / week / month — below fold so first viewport matches sheet. */}
        <Disclose
          style={styles.discloseBlock}
          label={scheduleSectionLabel}
          labelExpanded={t.home.showLess}
          defaultOpen={false}
        >
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

          {scheduleView === "day" ? (
            dayTimelineItems.length > 0 ? (
              <DayScheduleView
                day={today}
                items={dayTimelineItems}
                onEventPress={openMeeting}
                onTaskPress={onTimelineTaskPress}
                emptyText={t.home.scheduleEmpty}
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
        </Disclose>
      </ScrollView>

      <View style={styles.commandBox}>
        <View style={styles.sparkleDot}>
          <Ic.Sparkles size={17} color="#5D5CE6" stroke={2} />
        </View>
        <TextInput
          value={composer}
          onChangeText={setComposer}
          placeholder={t.home.composerPlaceholder}
          placeholderTextColor="#9AA4B5"
          style={styles.composerInput}
          multiline
          maxLength={500}
          returnKeyType="send"
          blurOnSubmit
          onSubmitEditing={submitComposer}
          editable={!asking}
        />
        <Pressable
          style={styles.composerMic}
          onPress={() => openAlfred()}
          accessibilityLabel="Voice input"
        >
          <Ic.Mic size={17} color="#60708D" stroke={2} />
        </Pressable>
        {asking ? (
          <View style={styles.sendCircle}>
            <ActivityIndicator size="small" color="#fff" />
          </View>
        ) : (
          <Pressable
            style={[
              styles.sendCircle,
              !composer.trim() && styles.sendDisabled,
            ]}
            onPress={composer.trim() ? submitComposer : undefined}
            accessibilityLabel={t.a11y.send}
          >
            <Ic.Send size={15} color="#FFFFFF" stroke={2} />
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.washBottom },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.washBottom,
  },
  scroll: { flex: 1, backgroundColor: "transparent" },
  content: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.xl + 24,
    gap: layout.gapSection,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
  },
  headerText: { flex: 1, minWidth: 0 },
  eyebrowDate: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: "#7E7B75",
    marginBottom: 8,
  },
  greeting: { maxWidth: 235, letterSpacing: -0.8 },
  greetingDesc: {
    marginTop: 0,
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 19,
    color: "#74736F",
    maxWidth: 235,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  bellDot: {
    position: "absolute",
    right: 8,
    top: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  dailySummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 78,
    paddingVertical: 14,
    paddingHorizontal: 14,
    ...surfaces.glassCard,
  },
  summaryCopy: { flex: 1, gap: 4, minWidth: 0 },
  summaryTitle: {
    fontFamily: fonts.sansSemibold,
    fontSize: 14,
    color: colors.ink2,
  },
  summarySub: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 16,
    color: colors.ink3,
  },
  butlerBlock: { marginTop: spacing.lg },
  proactiveCard: {
    ...surfaces.glassCard,
    padding: spacing.md,
    gap: 12,
  },
  proactiveText: { color: colors.ink, lineHeight: 26 },
  habitPattern: { fontSize: 13, color: colors.ink4, fontStyle: "italic" },
  proactiveBtn: { alignSelf: "flex-start" },
  habitActions: { gap: 10 },
  scheduleProposalActions: { gap: 10 },
  dismissProposal: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink4 },
  sectionLabel: {
    ...surfaces.sectionKicker,
    marginBottom: 6,
  },
  inboxSection: {
    marginTop: layout.gapSection,
  },
  inboxHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginHorizontal: 4,
    marginBottom: 14,
  },
  inboxTitle: {
    fontFamily: fonts.serifDisplay,
    fontSize: 20,
    letterSpacing: -0.4,
    color: colors.ink,
  },
  viewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingBottom: 2,
  },
  viewAllText: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: "#64708A",
  },
  emailCard: {
    ...surfaces.glassCard,
    borderRadius: 18,
    overflow: "hidden",
  },
  inboxEmpty: {
    padding: 18,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink3,
    fontStyle: "italic",
  },
  emailRow: {
    position: "relative",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  senderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0EEE9",
  },
  senderInitial: {
    fontFamily: fonts.sansSemibold,
    fontSize: 13,
    color: "#2A3D62",
  },
  senderStatus: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  emailContent: {
    flex: 1,
    minWidth: 0,
    gap: 3,
    paddingRight: 4,
  },
  emailMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  emailSender: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.ink3,
  },
  emailTime: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: colors.ink3,
  },
  emailSubject: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    color: colors.ink,
  },
  emailPreview: {
    fontFamily: fonts.sans,
    fontSize: 9,
    lineHeight: 14,
    color: colors.ink3,
  },
  statusDonePill: {
    ...surfaces.statusPillDone,
  },
  statusDoneText: {
    ...surfaces.statusPillDoneText,
  },
  emailDivider: {
    position: "absolute",
    left: 56,
    right: 12,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
  },
  discloseBlock: { marginTop: spacing.md },
  weekAheadText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink3,
  },
  conversationCard: {
    backgroundColor: colors.glass,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hair,
    padding: spacing.md,
    gap: 10,
  },
  conversationSummary: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink2,
    lineHeight: 20,
  },
  conversationRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  conversationKind: { fontSize: 14, color: colors.ink3, marginTop: 2 },
  conversationBody: { flex: 1, gap: 2 },
  conversationTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
  conversationMeta: { fontSize: 12, color: colors.ink4, fontStyle: "italic" },
  conversationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 6,
  },
  conversationActionAccent: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.accent,
  },
  conversationActionMuted: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink3,
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 4,
  },
  reminderTitle: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink2,
  },
  reminderWhen: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink4 },
  approvalsBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.warnSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  approvalsText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    color: colors.warn,
    fontSize: 13,
  },
  scheduleHeader: {
    marginTop: layout.gapSection,
    marginBottom: 10,
    gap: 10,
  },
  scheduleToggle: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  scheduleTogglePill: { marginRight: 0 },
  scheduleEmpty: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink3,
    fontStyle: "italic",
  },
  commandBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: layout.padX,
    marginBottom: layout.tabBarInset,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 7,
    minHeight: 50,
    ...surfaces.glassCard,
    borderRadius: 18,
  },
  sparkleDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1EFFF",
  },
  composerMic: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  sendCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  composerInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.ink,
    minHeight: 28,
    maxHeight: 88,
    paddingVertical: 4,
  },
  sendDisabled: {
    opacity: 0.38,
  },
});
