// Chats workbench — WeChat / SMS / WhatsApp paste + threads.
// Inbox → Reply still uses AskScreen task thread when Workflow `thread` is set.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  CommitmentStatus,
  TaskStatus,
  type ConversationInboxItem,
} from "@albert/shared-types";

import { api } from "@/api/client";
import { Btn, Eyebrow, Serif } from "@/components/ui";
import { useShell } from "@/components/Shell";
import { useLocale } from "@/context/LocaleContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { type AppInboxItem, mapInboxMessage } from "@/lib/inbox";
import { enrichInboxMessages } from "@/lib/smsSenderDisplay";
import { cancelLocalTaskReminder } from "@/lib/taskReminders";
import { AskScreen } from "@/screens/AskScreen";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";

type Channel = "wechat" | "sms" | "whatsapp";

export function ChatsScreen() {
  const { thread } = useWorkflow();

  // Inbox → reply / delegate still uses the existing Ask task-thread UI.
  if (thread) {
    return <AskScreen />;
  }

  return <ChatsEmpty />;
}

function ChatsEmpty() {
  const router = useRouter();
  const { t } = useLocale();
  const { showToast } = useShell();
  const { openChatFromInbox } = useWorkflow();
  const c = t.chats;
  const [channel, setChannel] = useState<Channel>("wechat");
  const [smsItems, setSmsItems] = useState<AppInboxItem[]>([]);
  const [conversationItems, setConversationItems] = useState<
    ConversationInboxItem[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const channels: { key: Channel; label: string }[] = [
    { key: "wechat", label: c.channelWechat },
    { key: "sms", label: c.channelSms },
    { key: "whatsapp", label: c.channelWhatsapp },
  ];

  const loadSms = useCallback(async () => {
    const view = await api.getInbox({ scope: "sms" });
    const mapped = view.messages.map(mapInboxMessage);
    const enriched = await enrichInboxMessages(mapped, view.messages);
    setSmsItems(enriched);
  }, []);

  const loadConversations = useCallback(async () => {
    const inbox = await api.getConversationInbox().catch(() => ({
      items: [] as ConversationInboxItem[],
      counts: {},
    }));
    setConversationItems(Array.isArray(inbox?.items) ? inbox.items : []);
  }, []);

  const load = useCallback(async () => {
    try {
      if (channel === "sms") {
        await loadSms();
      } else {
        await loadConversations();
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : c.loadFailed);
      if (channel === "sms") setSmsItems([]);
      else setConversationItems([]);
    }
  }, [channel, loadSms, loadConversations, showToast, c.loadFailed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await load();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const removeConversationItem = useCallback((item: ConversationInboxItem) => {
    setConversationItems((rows) =>
      rows.filter((r) => !(r.id === item.id && r.kind === item.kind)),
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
            status === "done"
              ? CommitmentStatus.Done
              : CommitmentStatus.Dismissed,
          );
        }
        removeConversationItem(item);
        if (!opts?.silent) {
          showToast(
            status === "done"
              ? t.home.followUpMarkedDone
              : t.home.followUpIgnored,
          );
        }
        return true;
      } catch {
        showToast(t.home.followUpUpdateFailed);
        return false;
      }
    },
    [
      removeConversationItem,
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
        if (
          res.action === "booked" ||
          res.action === "created" ||
          res.action === "updated"
        ) {
          const resolved = await resolveConversationItem(item, "done", {
            silent: true,
          });
          if (resolved) showToast(t.home.followUpCalendarOk);
        } else {
          showToast(res.reply || t.home.followUpCalendarFailed);
        }
      } catch {
        showToast(t.home.followUpCalendarFailed);
      }
    },
    [
      resolveConversationItem,
      showToast,
      t.home.followUpCalendarFailed,
      t.home.followUpCalendarOk,
    ],
  );

  const channelExplain =
    channel === "wechat"
      ? c.explainWechat
      : channel === "whatsapp"
        ? c.explainWhatsapp
        : c.explainSms;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.header}>
        <Eyebrow>{c.eyebrow}</Eyebrow>
        <Serif size={28}>{c.title}</Serif>
        <Text style={styles.sub}>{c.sub}</Text>
      </View>

      <View style={styles.pills}>
        {channels.map((ch) => {
          const active = channel === ch.key;
          return (
            <Pressable
              key={ch.key}
              onPress={() => setChannel(ch.key)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                {ch.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Btn
        label={c.importCta}
        kind="ink"
        full
        onPress={() => router.push("/import")}
      />

      <Text style={styles.explain}>{channelExplain}</Text>
      {channel !== "sms" ? (
        <Text style={styles.hint}>{c.keyboardHint}</Text>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : channel === "sms" ? (
        <SmsList
          items={smsItems}
          empty={c.emptySms}
          emptyHint={c.emptyHintSms}
          replyLabel={c.replyCta}
          onOpen={(item) =>
            openChatFromInbox(item.id, "reply", {
              source: item.source,
              replyPhone: item.replyPhone,
              sender: item.sender,
              title: item.title,
              take: item.take,
            })
          }
        />
      ) : (
        <FollowUpList
          items={conversationItems}
          empty={channel === "wechat" ? c.emptyWechat : c.emptyWhatsapp}
          emptyHint={c.emptyHint}
          sectionLabel={c.followUpsTitle}
          addCalendar={t.home.followUpAddCalendar}
          ignore={t.home.followUpIgnore}
          done={t.home.followUpDone}
          evidence={t.home.conversationEvidence}
          sourceFallback={t.home.conversationSource}
          onAddCalendar={addConversationToCalendar}
          onIgnore={(item) => void resolveConversationItem(item, "dismissed")}
          onDone={(item) => void resolveConversationItem(item, "done")}
        />
      )}
    </ScrollView>
  );
}

function SmsList({
  items,
  empty,
  emptyHint,
  replyLabel,
  onOpen,
}: {
  items: AppInboxItem[];
  empty: string;
  emptyHint: string;
  replyLabel: string;
  onOpen: (item: AppInboxItem) => void;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.empty}>{empty}</Text>
        <Text style={styles.hint}>{emptyHint}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listBlock}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          style={styles.smsRow}
          onPress={() => onOpen(item)}
        >
          <View style={styles.smsTop}>
            <Text style={styles.smsSender} numberOfLines={1}>
              {item.sender}
            </Text>
            {item.isUnread ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text style={styles.smsPreview} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.smsReply}>{replyLabel}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function FollowUpList({
  items,
  empty,
  emptyHint,
  sectionLabel,
  addCalendar,
  ignore,
  done,
  evidence,
  sourceFallback,
  onAddCalendar,
  onIgnore,
  onDone,
}: {
  items: ConversationInboxItem[];
  empty: string;
  emptyHint: string;
  sectionLabel: string;
  addCalendar: string;
  ignore: string;
  done: string;
  evidence: (quote: string) => string;
  sourceFallback: string;
  onAddCalendar: (item: ConversationInboxItem) => void;
  onIgnore: (item: ConversationInboxItem) => void;
  onDone: (item: ConversationInboxItem) => void;
}) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyBlock}>
        <Text style={styles.empty}>{empty}</Text>
        <Text style={styles.hint}>{emptyHint}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listBlock}>
      <Text style={styles.sectionLabel}>{sectionLabel}</Text>
      <View style={styles.followCard}>
        {items.map((item) => (
          <View key={`${item.kind}-${item.id}`} style={styles.followRow}>
            <Text style={styles.followKind}>
              {item.kind === "calendar_event"
                ? "📅"
                : item.kind === "follow_up"
                  ? "↻"
                  : "□"}
            </Text>
            <View style={styles.followBody}>
              <Text style={styles.followTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={styles.followMeta} numberOfLines={1}>
                {item.evidence
                  ? evidence(item.evidence)
                  : item.source_label || sourceFallback}
              </Text>
              <View style={styles.followActions}>
                <Pressable onPress={() => onAddCalendar(item)} hitSlop={6}>
                  <Text style={styles.actionAccent}>{addCalendar}</Text>
                </Pressable>
                <Pressable onPress={() => onIgnore(item)} hitSlop={6}>
                  <Text style={styles.actionMuted}>{ignore}</Text>
                </Pressable>
                <Pressable onPress={() => onDone(item)} hitSlop={6}>
                  <Text style={styles.actionMuted}>{done}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  header: { gap: spacing.sm },
  sub: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink3,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.paper,
  },
  pillActive: {
    borderColor: colors.ink,
    backgroundColor: colors.ink,
  },
  pillLabel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: colors.ink2,
  },
  pillLabelActive: { color: colors.paper },
  explain: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 24,
    color: colors.ink,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink3,
  },
  loading: {
    paddingVertical: spacing.xl,
    alignItems: "center",
  },
  emptyBlock: { gap: spacing.sm, marginTop: spacing.sm },
  empty: {
    fontFamily: fonts.serif,
    fontSize: 18,
    lineHeight: 26,
    color: colors.ink,
  },
  listBlock: { gap: spacing.sm, marginTop: spacing.sm },
  sectionLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  smsRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    padding: spacing.md,
    gap: 4,
  },
  smsTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  smsSender: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 15,
    fontWeight: "600",
    color: colors.ink,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  smsPreview: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.ink2,
  },
  smsReply: {
    marginTop: 4,
    fontFamily: fonts.sans,
    fontSize: 13,
    fontWeight: "600",
    color: colors.accent,
  },
  followCard: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    padding: spacing.md,
    gap: 12,
  },
  followRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  followKind: { fontSize: 14, color: colors.ink3, marginTop: 2 },
  followBody: { flex: 1, gap: 2 },
  followTitle: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  followMeta: { fontSize: 12, color: colors.ink4, fontStyle: "italic" },
  followActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 6,
  },
  actionAccent: {
    fontSize: 13,
    color: colors.accent,
    fontWeight: "600",
  },
  actionMuted: {
    fontSize: 13,
    color: colors.ink3,
    fontWeight: "500",
  },
});
