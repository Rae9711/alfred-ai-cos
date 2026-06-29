// Today priority strip — priorities, waiting, quick wins, meetings to prepare.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  CommitmentStatus,
  TaskStatus,
  type Task,
  type TodayDashboard,
} from "@albert/shared-types";

import { api } from "@/api/client";
import { PriorityCard } from "@/components/PriorityCard";
import { useShell } from "@/components/Shell";
import { ApprovalSheet } from "@/screens/sheets/ApprovalSheet";
import { MeetingPrepSheet } from "@/screens/sheets/MeetingPrepSheet";
import { SnoozeSheet } from "@/screens/sheets/SnoozeSheet";
import {
  Avatar,
  Card,
  Check,
  Meta,
  Pill,
  SectionTitle,
  Serif,
} from "@/components/ui";
import { Ic } from "@/components/icons";
import { colors, layout, spacing } from "@/theme/theme";

type Props = {
  data: TodayDashboard | null;
  tasks: Task[];
  onRefresh: () => void;
};

export function TodayPrioritiesSection({ data, tasks, onRefresh }: Props) {
  const router = useRouter();
  const { openSheet, showToast } = useShell();
  const [completing, setCompleting] = useState<Set<string>>(new Set());
  const commitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    const timers = commitTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  const undoComplete = useCallback((id: string) => {
    const timer = commitTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      commitTimers.current.delete(id);
    }
    setCompleting((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }, []);

  const markPriorityDone = useCallback(
    (id: string) => {
      setCompleting((s) => new Set(s).add(id));
      const timer = setTimeout(() => {
        commitTimers.current.delete(id);
        api
          .updateCommitmentStatus(id, CommitmentStatus.Done)
          .then(() => onRefresh())
          .catch(() => {
            undoComplete(id);
            showToast("Couldn't update");
          });
      }, 4000);
      commitTimers.current.set(id, timer);
      showToast("Marked done.", {
        action: { label: "Undo", onPress: () => undoComplete(id) },
        duration: 4000,
      });
    },
    [onRefresh, showToast, undoComplete],
  );

  const snoozePriority = useCallback(
    (id: string) => {
      openSheet(
        <SnoozeSheet commitmentId={id} onDone={() => void onRefresh()} />,
      );
    },
    [onRefresh, openSheet],
  );

  const dismissPriority = useCallback(
    async (id: string) => {
      await api.updateCommitmentStatus(id, CommitmentStatus.Dismissed);
      showToast("Got it. I'll stop bringing this up.");
      onRefresh();
    },
    [onRefresh, showToast],
  );

  const completeQuickWin = useCallback(
    (task: Task) => {
      setCompleting((s) => new Set(s).add(task.id));
      const timer = setTimeout(() => {
        commitTimers.current.delete(task.id);
        api
          .updateTaskStatus(task.id, TaskStatus.Done)
          .then(() => onRefresh())
          .catch(() => {
            undoComplete(task.id);
            showToast("Couldn't update task");
          });
      }, 4000);
      commitTimers.current.set(task.id, timer);
      showToast("Marked done.", {
        action: { label: "Undo", onPress: () => undoComplete(task.id) },
        duration: 4000,
      });
    },
    [onRefresh, showToast, undoComplete],
  );

  if (!data) return null;

  const quickWins = tasks.filter(
    (t) => t.priority === "low" && t.status !== TaskStatus.Done,
  );
  const waiting = data.people_waiting_on_you ?? [];

  return (
    <View style={styles.wrap}>
      <View style={styles.countStrip}>
        <Stat n={data.top_priorities.length} label="matter today" />
        <Stat n={data.people_waiting_on_you.length} label="waiting on you" />
        <Stat n={data.meetings_to_prepare.length} label="meetings" />
      </View>

      <SectionTitle
        label="What matters today"
        right={<Meta>{data.top_priorities.length} open</Meta>}
      />
      {data.top_priorities.length ? (
        <View style={styles.cardStack}>
          {data.top_priorities.map((item) => (
            <PriorityCard
              key={item.id}
              item={item}
              done={completing.has(item.id)}
              onAct={() =>
                openSheet(
                  <ApprovalSheet
                    commitmentId={item.id}
                    recipient={item.counterparty ?? "them"}
                    onDone={() => void onRefresh()}
                  />,
                )
              }
              onMarkDone={() => void markPriorityDone(item.id)}
              onSnooze={() => snoozePriority(item.id)}
              onDismiss={() => void dismissPriority(item.id)}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>
          Nothing pressing. Pull to sync and find open loops.
        </Text>
      )}

      {waiting.length ? (
        <>
          <SectionTitle
            label="Waiting on you"
            right={
              <Pill
                label="View all"
                kind="muted"
                mono={false}
                onPress={() => router.push("/waiting")}
              />
            }
          />
          <Card style={styles.list}>
            {waiting.slice(0, 4).map((w, i) => (
              <Pressable
                key={w.id}
                onPress={() => router.push("/waiting")}
                style={({ pressed }) => [
                  styles.waitRow,
                  i > 0 && styles.rowDivider,
                  pressed && styles.rowPressed,
                ]}
              >
                <Avatar name={w.person ?? "Someone"} size={32} />
                <View style={styles.waitBody}>
                  <Text style={styles.waitText}>{w.description}</Text>
                  {w.person ? <Meta>{w.person}</Meta> : null}
                </View>
                <Ic.Arrow size={16} color={colors.ink4} />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {quickWins.length ? (
        <>
          <SectionTitle
            label="Quick wins"
            right={<Meta>{quickWins.length} small</Meta>}
          />
          <View style={styles.quickStack}>
            {quickWins.slice(0, 5).map((t) => (
              <QuickWinRow
                key={t.id}
                title={t.title}
                done={completing.has(t.id)}
                onDone={() => void completeQuickWin(t)}
              />
            ))}
          </View>
        </>
      ) : null}

      {data.meetings_to_prepare.length ? (
        <>
          <SectionTitle label="Meetings to prepare" />
          <View style={styles.cardStack}>
            {data.meetings_to_prepare.map((m) => (
              <Card
                key={m.id}
                flat
                style={styles.meeting}
                onPress={() => openSheet(<MeetingPrepSheet eventId={m.id} />)}
              >
                <Serif size={16}>{m.title ?? "Meeting"}</Serif>
                {m.start_time ? (
                  <Meta>{new Date(m.start_time).toLocaleString()}</Meta>
                ) : null}
              </Card>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Serif size={26}>{String(n)}</Serif>
      <Meta>{label}</Meta>
    </View>
  );
}

function QuickWinRow({
  title,
  done,
  onDone,
}: {
  title: string;
  done: boolean;
  onDone: () => void;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: done ? 0.5 : 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [done, opacity]);
  return (
    <Animated.View style={[styles.quickRow, { opacity }]}>
      <Check done={done} onPress={onDone} />
      <Text style={[styles.quickText, done && styles.quickTextDone]}>
        {title}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  countStrip: { flexDirection: "row", gap: spacing.sm },
  stat: {
    flex: 1,
    gap: 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
  },
  cardStack: { gap: layout.gapCard },
  quickStack: { gap: 6 },
  empty: { color: colors.ink3, fontSize: 13, fontStyle: "italic" },
  list: { padding: 0 },
  waitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
  },
  rowPressed: { backgroundColor: colors.paper2 },
  waitBody: { flex: 1, minWidth: 0, gap: 2 },
  waitText: { color: colors.ink, fontSize: 14, lineHeight: 19 },
  quickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
  },
  quickText: { flex: 1, color: colors.ink, fontSize: 14 },
  quickTextDone: { textDecorationLine: "line-through", color: colors.ink4 },
  meeting: { gap: 3 },
});
