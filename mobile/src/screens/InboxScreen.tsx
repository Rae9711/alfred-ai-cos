// Inbox — live Gmail messages from Albert's classification pipeline.

import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native";

import { Btn, Pill, Serif, SerifEm } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { SOURCE_FILTER_IDS, type InboxSource } from "@/data/workflowDemo";
import type { AppInboxItem } from "@/lib/inbox";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ease = () =>
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

export function InboxScreen() {
  const { t } = useLocale();
  const { openChatFromInbox } = useWorkflow();
  const { items, loading, syncing, error, syncAndRefresh } = useMailbox();
  const [filter, setFilter] = useState("all");
  const [deferred, setDeferred] = useState<Set<string>>(new Set());

  const live = useMemo(
    () => items.filter((m) => !deferred.has(m.id)),
    [items, deferred],
  );

  const filtered = useMemo(() => {
    const f = SOURCE_FILTER_IDS.find((x) => x.id === filter);
    if (!f || f.match === null) return live;
    return live.filter((m) => m.source === f.match);
  }, [live, filter]);

  const replyItems = filtered.filter((m) => m.section === "reply");
  const fyiItems = filtered.filter((m) => m.section === "fyi");
  const unread = live.filter((m) => m.section === "reply").length;

  const defer = (id: string) => {
    ease();
    setDeferred((s) => new Set(s).add(id));
  };

  const filterLabel = (id: string) => {
    const key = id as keyof typeof t.inbox.filters;
    return t.inbox.filters[key] ?? id;
  };

  const sourceLabel = (source: InboxSource) => t.inbox.sources[source];

  if (loading && items.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>{t.inbox.syncing}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          onRefresh={() => void syncAndRefresh()}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.header}>
        <Serif size={28}>
          {t.inbox.titlePlain} <SerifEm>{t.inbox.titleEm}</SerifEm>
        </Serif>
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t.inbox.unread(unread)}</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <Pressable style={styles.errorBanner} onPress={() => void syncAndRefresh()}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorRetry}>{t.inbox.retry}</Text>
        </Pressable>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filters}
      >
        {SOURCE_FILTER_IDS.map((f) => (
          <Pill
            key={f.id}
            label={filterLabel(f.id)}
            kind={filter === f.id ? "accent" : "muted"}
            mono={false}
            onPress={() => setFilter(f.id)}
            style={styles.filterPill}
          />
        ))}
      </ScrollView>

      {filter === "wechat" && filtered.length === 0 ? (
        <View style={styles.empty}>
          <Serif size={17} italic color={colors.ink3}>
            {t.inbox.wechatEmpty}
          </Serif>
          <Text style={styles.emptySub}>{t.inbox.wechatEmptySub}</Text>
        </View>
      ) : null}

      {replyItems.length > 0 ? (
        <Section title={t.inbox.sectionReply}>
          {replyItems.map((m) => (
            <InboxCard
              key={m.id}
              item={m}
              sourceLabel={sourceLabel(m.source)}
              onReply={() => openChatFromInbox(m.id, "reply")}
              onLater={() => defer(m.id)}
              onDelegate={() => openChatFromInbox(m.id, "delegate")}
              labels={{
                reply: t.inbox.reply,
                later: t.inbox.later,
                delegate: t.inbox.handToAlfred,
              }}
            />
          ))}
        </Section>
      ) : null}

      {fyiItems.length > 0 ? (
        <Section title={t.inbox.sectionFyi}>
          {fyiItems.map((m) => (
            <FyiCard
              key={m.id}
              item={m}
              sourceLabel={sourceLabel(m.source)}
              onDismiss={() => defer(m.id)}
              labels={{ view: t.inbox.view, dismiss: t.inbox.dismiss }}
            />
          ))}
        </Section>
      ) : null}

      {filtered.length === 0 && filter !== "wechat" ? (
        <View style={styles.empty}>
          <Serif size={17} italic color={colors.ink3}>
            {t.inbox.inboxZero}
          </Serif>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InboxCard({
  item,
  sourceLabel,
  onReply,
  onLater,
  onDelegate,
  labels,
}: {
  item: AppInboxItem;
  sourceLabel: string;
  onReply: () => void;
  onLater: () => void;
  onDelegate: () => void;
  labels: { reply: string; later: string; delegate: string };
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.sourceChip}>
          <Text style={styles.sourceChipText}>{sourceLabel}</Text>
        </View>
        <Text style={styles.sender}>{item.sender}</Text>
      </View>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.summary}>{item.summary}</Text>
      <View style={styles.tags}>
        {item.tags.map((tag) => (
          <Pill key={tag.label} label={tag.label} kind={tag.tone} mono />
        ))}
      </View>
      <View style={styles.actions}>
        <Btn label={labels.reply} onPress={onReply} style={styles.actionPrimary} />
        <Pressable style={styles.actionGhost} onPress={onLater}>
          <Text style={styles.actionGhostText}>{labels.later}</Text>
        </Pressable>
        <Pressable style={styles.actionGhost} onPress={onDelegate}>
          <Text style={styles.actionGhostText}>{labels.delegate}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FyiCard({
  item,
  sourceLabel,
  onDismiss,
  labels,
}: {
  item: AppInboxItem;
  sourceLabel: string;
  onDismiss: () => void;
  labels: { view: string; dismiss: string };
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.sourceChip}>
          <Text style={styles.sourceChipText}>{sourceLabel}</Text>
        </View>
        <Text style={styles.sender}>{item.sender}</Text>
      </View>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.summary}>{item.summary}</Text>
      <View style={styles.tags}>
        {item.tags.map((tag) => (
          <Pill key={tag.label} label={tag.label} kind={tag.tone} mono />
        ))}
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.actionGhost}>
          <Text style={styles.actionGhostText}>{labels.view}</Text>
        </Pressable>
        <Pressable style={styles.actionGhost} onPress={onDismiss}>
          <Text style={styles.actionGhostText}>{labels.dismiss}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.paper,
  },
  loadingText: { fontSize: 14, color: colors.ink3 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 14,
  },
  badge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.accentInk,
    textTransform: "uppercase",
  },
  errorBanner: {
    backgroundColor: colors.warnSoft,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 4,
  },
  errorText: { fontSize: 13, color: colors.ink2 },
  errorRetry: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    color: colors.accentInk,
    textTransform: "uppercase",
  },
  filters: { gap: 8, paddingBottom: 16 },
  filterPill: { marginRight: 0 },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    padding: spacing.md,
    marginBottom: 10,
    gap: 8,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sourceChip: {
    backgroundColor: colors.paper2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sourceChipText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.ink3,
    textTransform: "uppercase",
  },
  sender: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  summary: { fontSize: 14, color: colors.ink3, lineHeight: 20 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
    alignItems: "center",
  },
  actionPrimary: { paddingHorizontal: 16 },
  actionGhost: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.paper2,
  },
  actionGhostText: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.ink2,
  },
  empty: {
    marginTop: 40,
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  emptySub: { fontSize: 14, color: colors.ink4, textAlign: "center" },
});
