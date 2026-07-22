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
import { type Me, type Task, TaskStatus, CommitmentStatus, type TodayDashboard, type UpcomingMeeting, type ConversationInboxItem } from "@albert/shared-types";

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
  buildDayTimelineItems,
} from "@/lib/schedule";
import { greetingForLocale } from "@/i18n/locales";
import { parseSmsComposeIntent } from "@/lib/smsComposeIntent";
import {
  cancelLocalTaskReminder,
  scheduleFromAssistantResponse,
  syncLocalRemindersForTasks,
} from "@/lib/taskReminders";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";

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
  const { meta, state, setThinking, flashState } = useCompanionAvatar();
  const { locale, t } = useLocale();
  const { syncAndRefresh } = useMailbox();
  const { openAlfred, openConfirmReply } = useWorkflow();

  const [me, setMe] = useState<Me | null>(null);
  const [meetings, setMeetings] = useState<UpcomingMeeting[]>([]);
  const [todayData, setTodayData] = useState<TodayDashboard | null>(null);
  const [reminders, setReminders] = useState<Task[]>([]);
  const [conversationItems, setConversationItems] = useState<ConversationInboxItem[]>([]);
  const [conversationCounts, setConversationCounts] = useState<Record<string, number>>({});
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
      const [profile, pending, upcoming, today, upcomingReminders, conversationInbox] =
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
        ]);
      setMe(profile);
      setPendingCount(pending.length);
      setMeetings(upcoming);
      setTodayData(today);
      setReminders(upcomingReminders);
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
          {todayData?.day_overview ? (
            <Text style={styles.dayOverview}>{todayData.day_overview}</Text>
          ) : null}
          <View style={styles.proactiveCard}>
            {weekAhead?.show_prominently ? (
              <View style={styles.weekAheadBlock}>
                <Text style={styles.weekAheadLabel}>{t.home.weekAheadLabel}</Text>
                <Text style={styles.weekAheadText}>{weekAhead.summary}</Text>
              </View>
            ) : null}
            <Serif size={17} style={styles.proactiveText}>
              {butlerPrompt}
            </Serif>
            {topHabitSuggestion && !topScheduleProposal ? (
              <Text style={styles.habitPattern}>{topHabitSuggestion.pattern_summary}</Text>
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
                  <Text style={styles.dismissProposal}>{t.home.dismissProposal}</Text>
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
                  <Text style={styles.dismissProposal}>{t.home.dismissProposal}</Text>
                </Pressable>
              </View>
            ) : null}
            {reminders.length > 0 ? (
              <View style={styles.remindersBlock}>
                <Text style={styles.remindersLabel}>{t.home.upcomingReminders}</Text>
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
              </View>
            ) : null}
          </View>
        </View>

        {conversationItems.length > 0 ? (
          <View style={styles.conversationBlock}>
            <Text style={styles.butlerLabel}>{t.home.fromConversations}</Text>
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
                      ? "📅"
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
          </View>
        ) : null}

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
  conversationBlock: { marginTop: spacing.lg, gap: 8 },
  conversationCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    padding: spacing.md,
    gap: 10,
  },
  conversationSummary: { fontSize: 14, color: colors.ink2, lineHeight: 20 },
  conversationRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  conversationKind: { fontSize: 14, color: colors.ink3, marginTop: 2 },
  conversationBody: { flex: 1, gap: 2 },
  conversationTitle: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  conversationMeta: { fontSize: 12, color: colors.ink4, fontStyle: "italic" },
  conversationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 6,
  },
  conversationActionAccent: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: "600",
  },
  conversationActionMuted: {
    fontSize: 13,
    color: colors.ink3,
    fontWeight: "500",
  },
  butlerLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  dayOverview: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink3,
    fontStyle: "italic",
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
  habitPattern: { fontSize: 13, color: colors.ink4, fontStyle: "italic" },
  weekAheadBlock: { gap: 4, paddingBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair2 },
  weekAheadLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  weekAheadText: { fontSize: 14, lineHeight: 20, color: colors.ink3 },
  proactiveBtn: { alignSelf: "flex-start" },
  habitActions: { gap: 10 },
  scheduleProposalActions: { gap: 10 },
  dismissProposal: { fontSize: 13, color: colors.ink4 },
  remindersBlock: { gap: 8, marginTop: 4 },
  remindersLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  reminderTitle: { flex: 1, fontSize: 14, color: colors.ink2 },
  reminderWhen: { fontSize: 12, color: colors.ink4 },
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
