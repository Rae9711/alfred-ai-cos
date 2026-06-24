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

function mailboxTabLabel(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export function InboxScreen() {
  const { t } = useLocale();
  const { openChatFromInbox } = useWorkflow();
  const { items, mailboxes, loading, syncing, error, syncAndRefresh } =
    useMailbox();
  const [filter, setFilter] = useState("all");
  const [deferred, setDeferred] = useState<Set<string>>(new Set());

  const mailboxTabs = useMemo(
    () => [
      { id: "all", label: t.inbox.filters.all },
      ...mailboxes.map((email) => ({
        id: email,
        label: mailboxTabLabel(email),
      })),
    ],
    [mailboxes, t.inbox.filters.all],
  );

  const live = useMemo(
    () => items.filter((m) => !deferred.has(m.id)),
    [items, deferred],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return live;
    return live.filter((m) => m.mailboxEmail === filter);
  }, [live, filter]);

  const replyItems = filtered.filter((m) => m.section === "reply");
  const fyiItems = filtered.filter((m) => m.section === "fyi");
  const unread = live.filter((m) => m.isUnread && m.section === "reply").length;
  const showMailboxChip = mailboxes.length > 1;

  const defer = (id: string) => {
    ease();
    setDeferred((s) => new Set(s).add(id));
  };

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

      {mailboxTabs.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {mailboxTabs.map((f) => (
            <Pill
              key={f.id}
              label={f.label}
              kind={filter === f.id ? "accent" : "muted"}
              mono={false}
              onPress={() => setFilter(f.id)}
              style={styles.filterPill}
            />
          ))}
        </ScrollView>
      ) : null}

      {replyItems.length > 0 ? (
        <Section title={t.inbox.sectionReply}>
          {replyItems.map((m) => (
            <InboxCard
              key={m.id}
              item={m}
              mailboxLabel={
                showMailboxChip && m.mailboxEmail
                  ? mailboxTabLabel(m.mailboxEmail)
                  : null
              }
              onReply={() => openChatFromInbox(m.id, "reply")}
              onLater={() => defer(m.id)}
              onDelegate={() => openChatFromInbox(m.id, "delegate")}
              labels={{
                reply: t.inbox.reply,
                later: t.inbox.later,
                delegate: t.inbox.handToAlfred,
                read: t.inbox.read,
                replied: t.inbox.replied,
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
              mailboxLabel={
                showMailboxChip && m.mailboxEmail
                  ? mailboxTabLabel(m.mailboxEmail)
                  : null
              }
              onDismiss={() => defer(m.id)}
              labels={{ view: t.inbox.view, dismiss: t.inbox.dismiss, read: t.inbox.read, replied: t.inbox.replied }}
            />
          ))}
        </Section>
      ) : null}

      {filtered.length === 0 ? (
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
  mailboxLabel,
  onReply,
  onLater,
  onDelegate,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onReply: () => void;
  onLater: () => void;
  onDelegate: () => void;
  labels: { reply: string; later: string; delegate: string; read: string; replied: string };
}) {
  return (
    <View style={[styles.card, !item.isUnread && styles.cardRead]}>
      <View style={styles.cardTop}>
        {mailboxLabel ? (
          <View style={styles.sourceChip}>
            <Text style={styles.sourceChipText}>{mailboxLabel}</Text>
          </View>
        ) : null}
        {item.userReplied ? (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{labels.replied}</Text>
          </View>
        ) : !item.isUnread ? (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{labels.read}</Text>
          </View>
        ) : null}
        <Text style={[styles.sender, !item.isUnread && styles.senderRead]}>
          {item.sender}
        </Text>
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
  mailboxLabel,
  onDismiss,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onDismiss: () => void;
  labels: { view: string; dismiss: string; read: string; replied: string };
}) {
  return (
    <View style={[styles.card, !item.isUnread && styles.cardRead]}>
      <View style={styles.cardTop}>
        {mailboxLabel ? (
          <View style={styles.sourceChip}>
            <Text style={styles.sourceChipText}>{mailboxLabel}</Text>
          </View>
        ) : null}
        {item.userReplied ? (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{labels.replied}</Text>
          </View>
        ) : !item.isUnread ? (
          <View style={styles.statusChip}>
            <Text style={styles.statusChipText}>{labels.read}</Text>
          </View>
        ) : null}
        <Text style={[styles.sender, !item.isUnread && styles.senderRead]}>
          {item.sender}
        </Text>
      </View>
      <Text style={styles.cardTitle}>{item.title}</Text>
      <Text style={styles.summary}>{item.summary}</Text>
      <View style={styles.tags}>
        {item.tags.map((tag) => (
          <Pill key={tag.label} label={tag.label} kind={tag.tone} mono />
        ))}
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.actionGhost} onPress={onDismiss}>
          <Text style={styles.actionGhostText}>{labels.dismiss}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingBottom: 32 },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: colors.paper,
  },
  loadingText: { fontSize: 14, color: colors.ink3 },
  header: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  badge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  badgeText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.accent,
    textTransform: "uppercase",
  },
  errorBanner: {
    marginHorizontal: layout.padX,
    marginBottom: 12,
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.warnSoft,
  },
  errorText: { fontSize: 13, color: colors.warn },
  errorRetry: { fontSize: 12, color: colors.ink3, marginTop: 4 },
  filters: {
    paddingHorizontal: layout.padX,
    gap: 8,
    paddingBottom: spacing.md,
  },
  filterPill: { marginRight: 0 },
  section: {
    paddingHorizontal: layout.padX,
    marginTop: spacing.md,
    gap: 10,
  },
  sectionTitle: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
    marginBottom: 2,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    gap: 8,
  },
  cardRead: {
    opacity: 0.72,
    backgroundColor: colors.paper2,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  sourceChip: {
    backgroundColor: colors.paper2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  sourceChipText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.ink3,
  },
  statusChip: {
    backgroundColor: colors.paper,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
  },
  statusChipText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.ink4,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  sender: { fontSize: 13, fontWeight: "600", color: colors.ink2, flex: 1 },
  senderRead: { fontWeight: "500", color: colors.ink3 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  summary: { fontSize: 14, lineHeight: 20, color: colors.ink3 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  actionPrimary: { flexGrow: 1 },
  actionGhost: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.paper2,
  },
  actionGhostText: { fontSize: 13, fontWeight: "500", color: colors.ink2 },
  empty: { padding: layout.padX, paddingTop: 40, alignItems: "center" },
});
