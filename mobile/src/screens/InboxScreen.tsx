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

import { Btn, FooterStamp, Pill, Serif, SerifEm } from "@/components/ui";
import { useShell } from "@/components/Shell";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { useSmsShareTip } from "@/hooks/useSmsShareTip";
import type { AppInboxItem } from "@/lib/inbox";
import { MessageDetailSheet } from "@/screens/sheets/MessageDetailSheet";
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
  const { openSheet, closeSheet, showToast } = useShell();
  const { openChatFromInbox } = useWorkflow();
  const {
    items,
    mailboxes,
    inboxScope,
    loading,
    syncing,
    error,
    lastSyncedAt,
    syncAndRefresh,
    refresh,
    markRead,
    markDecided,
    setInboxFilter,
  } = useMailbox();
  useSmsShareTip(items);
  const [filter, setFilter] = useState("needs_action");
  const [deferred, setDeferred] = useState<Set<string>>(new Set());

  const mailboxTabs = useMemo(
    () => [
      { id: "unread", label: t.inbox.filters.unread },
      { id: "needs_action", label: t.inbox.filters.needsAction },
      { id: "sms", label: t.inbox.filters.sms },
      { id: "email", label: t.inbox.filters.email },
    ],
    [
      t.inbox.filters.unread,
      t.inbox.filters.needsAction,
      t.inbox.filters.sms,
      t.inbox.filters.email,
    ],
  );

  const live = useMemo(
    () => items.filter((m) => !deferred.has(m.id)),
    [items, deferred],
  );

  const filtered = live;
  const replyItems = filtered.filter((m) => m.section === "reply");
  const decisionItems = filtered.filter((m) => m.section === "decision");
  const fyiItems = filtered.filter((m) => m.section === "fyi");
  const unreadCount = live.filter((m) => m.isUnread).length;
  const showMailboxChip =
    filter === "email" && inboxScope === "synced" && mailboxes.length > 1;

  const onSelectFilter = (id: string) => {
    setFilter(id);
    void setInboxFilter(id);
  };

  const defer = (id: string) => {
    ease();
    setDeferred((s) => new Set(s).add(id));
    void markRead(id).catch(() => undefined);
  };

  const markAsRead = (id: string) => {
    ease();
    void (async () => {
      try {
        const gmailSynced = await markRead(id);
        showToast(
          gmailSynced ? t.inbox.markReadDone : t.inbox.markReadReconnect,
          { duration: gmailSynced ? 2200 : 4500 },
        );
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : t.inbox.markReadFailed,
        );
      }
    })();
  };

  const markAsDecided = (id: string) => {
    ease();
    void (async () => {
      try {
        await markDecided(id);
        showToast(t.inbox.markDecidedDone);
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : t.inbox.markReadFailed,
        );
      }
    })();
  };

  const markAsProcessed = (id: string) => {
    ease();
    void (async () => {
      try {
        await markDecided(id);
        showToast(t.inbox.markProcessedDone);
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : t.inbox.markReadFailed,
        );
      }
    })();
  };

  const openMessage = (id: string, mode: "reply" | "delegate" = "reply") => {
    const item = items.find((m) => m.id === id);
    openSheet(
      <MessageDetailSheet
        messageId={id}
        isUnread={item?.isUnread ?? false}
        onClose={closeSheet}
        onMarkRead={() => {
          markAsRead(id);
        }}
        onReply={() => {
          closeSheet();
          openChatFromInbox(id, mode);
        }}
      />,
    );
  };

  const onPullRefresh = async () => {
    try {
      if (filter === "sms") {
        await refresh();
        showToast(t.inbox.refreshed);
        return;
      }
      const ingested = await syncAndRefresh();
      showToast(ingested > 0 ? t.inbox.refreshed : t.inbox.upToDate);
    } catch {
      // error banner in MailboxContext
    }
  };

  const refreshControl = (
    <RefreshControl
      refreshing={syncing}
      onRefresh={() => void onPullRefresh()}
      tintColor={colors.accent}
      colors={[colors.accent]}
    />
  );

  const syncFooter = lastSyncedAt
    ? t.inbox.syncedJustNow
    : t.inbox.pullToSync;

  if (loading && items.length === 0) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.scrollFill}
        alwaysBounceVertical
        refreshControl={refreshControl}
      >
        <View style={styles.centeredFill}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>{t.inbox.syncing}</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical
      refreshControl={refreshControl}
    >
      <View style={styles.header}>
        <Serif size={28}>
          {t.inbox.titlePlain} <SerifEm>{t.inbox.titleEm}</SerifEm>
        </Serif>
        {unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{t.inbox.unread(unreadCount)}</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <Pressable style={styles.errorBanner} onPress={() => void onPullRefresh()}>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.errorRetry}>{t.inbox.retry}</Text>
        </Pressable>
      ) : null}

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
            onPress={() => onSelectFilter(f.id)}
            style={styles.filterPill}
          />
        ))}
      </ScrollView>

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
              onReply={() => openMessage(m.id, "reply")}
              onLater={() => defer(m.id)}
              onDelegate={() => openMessage(m.id, "delegate")}
              onProcessed={() => markAsProcessed(m.id)}
              onMarkRead={() => markAsRead(m.id)}
              onOpen={() => openMessage(m.id, "reply")}
              labels={{
                reply: t.inbox.reply,
                later: t.inbox.later,
                delegate: t.inbox.handToAlfred,
                processed: t.inbox.markProcessed,
                markRead: t.inbox.markReadAction,
                read: t.inbox.readLabel,
                unread: t.inbox.unreadLabel,
                replied: t.inbox.replied,
                albertTake: t.inbox.albertTake,
              }}
            />
          ))}
        </Section>
      ) : null}

      {decisionItems.length > 0 ? (
        <Section title={t.inbox.sectionDecision}>
          {decisionItems.map((m) => (
            <DecisionCard
              key={m.id}
              item={m}
              mailboxLabel={
                showMailboxChip && m.mailboxEmail
                  ? mailboxTabLabel(m.mailboxEmail)
                  : null
              }
              onDecided={() => markAsDecided(m.id)}
              onLater={() => defer(m.id)}
              onOpen={() => openMessage(m.id, "reply")}
              labels={{
                decided: t.inbox.markDecided,
                later: t.inbox.later,
                read: t.inbox.readLabel,
                unread: t.inbox.unreadLabel,
                replied: t.inbox.replied,
                albertTake: t.inbox.albertTake,
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
              onMarkRead={() => markAsRead(m.id)}
              onView={() => openMessage(m.id, "reply")}
              labels={{
                view: t.inbox.view,
                dismiss: t.inbox.dismiss,
                markRead: t.inbox.markReadAction,
                read: t.inbox.readLabel,
                unread: t.inbox.unreadLabel,
                replied: t.inbox.replied,
              }}
            />
          ))}
        </Section>
      ) : null}

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Serif size={17} italic color={colors.ink3}>
            {filter === "sms"
              ? t.inbox.smsEmpty
              : filter === "needs_action"
                ? t.inbox.needsActionEmpty
                : filter === "unread"
                  ? t.inbox.unreadEmpty
                  : t.inbox.inboxZero}
          </Serif>
          <Text style={styles.pullHint}>
            {filter === "sms"
              ? t.inbox.smsEmptySub
              : filter === "needs_action"
                ? t.inbox.needsActionEmptySub
                : filter === "unread"
                  ? t.inbox.unreadEmptySub
                  : t.inbox.pullToSync}
          </Text>
        </View>
      ) : null}

      <FooterStamp text={syncFooter} />
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

function ReadStatus({
  item,
  labels,
}: {
  item: AppInboxItem;
  labels: { read: string; unread: string; replied: string };
}) {
  if (item.userReplied) {
    return (
      <View style={[styles.statusChip, styles.statusReplied]}>
        <Text style={[styles.statusChipText, styles.statusRepliedText]}>
          {labels.replied}
        </Text>
      </View>
    );
  }
  if (item.isUnread) {
    return (
      <View style={[styles.statusChip, styles.statusUnread]}>
        <View style={styles.unreadDot} />
        <Text style={[styles.statusChipText, styles.statusUnreadText]}>
          {labels.unread}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.statusChip}>
      <Text style={styles.statusChipText}>{labels.read}</Text>
    </View>
  );
}

function InboxCard({
  item,
  mailboxLabel,
  onReply,
  onLater,
  onDelegate,
  onProcessed,
  onMarkRead,
  onOpen,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onReply: () => void;
  onLater: () => void;
  onDelegate: () => void;
  onProcessed: () => void;
  onMarkRead: () => void;
  onOpen: () => void;
  labels: {
    reply: string;
    later: string;
    delegate: string;
    processed: string;
    markRead: string;
    read: string;
    unread: string;
    replied: string;
    albertTake: string;
  };
}) {
  return (
    <View style={[styles.card, item.isUnread ? styles.cardUnread : styles.cardRead]}>
      <Pressable onPress={onOpen}>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <ReadStatus item={item} labels={labels} />
            {mailboxLabel ? (
              <View style={styles.sourceChip}>
                <Text style={styles.sourceChipText}>{mailboxLabel}</Text>
              </View>
            ) : null}
            <Text style={[styles.sender, item.isUnread ? styles.senderUnread : styles.senderRead]}>
              {item.sender}
            </Text>
          </View>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.take ? (
            <Text style={styles.summaryLabel}>{labels.albertTake}</Text>
          ) : null}
          <Text style={styles.summary}>{item.summary}</Text>
          <View style={styles.tags}>
            {item.tags.map((tag) => (
              <Pill key={tag.label} label={tag.label} kind={tag.tone} mono />
            ))}
          </View>
        </View>
      </Pressable>
      {item.showReplyActions || item.isUnread ? (
        <View style={styles.actions}>
          {item.showReplyActions ? (
            <>
              <Btn label={labels.reply} onPress={onReply} style={styles.actionPrimary} />
              <Pressable style={styles.actionGhost} onPress={onProcessed}>
                <Text style={styles.actionGhostText}>{labels.processed}</Text>
              </Pressable>
              <Pressable style={styles.actionGhost} onPress={onLater}>
                <Text style={styles.actionGhostText}>{labels.later}</Text>
              </Pressable>
              <Pressable style={styles.actionGhost} onPress={onDelegate}>
                <Text style={styles.actionGhostText}>{labels.delegate}</Text>
              </Pressable>
            </>
          ) : null}
          {item.isUnread ? (
            <Pressable style={styles.actionGhost} onPress={onMarkRead}>
              <Text style={styles.actionGhostText}>{labels.markRead}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function DecisionCard({
  item,
  mailboxLabel,
  onDecided,
  onLater,
  onOpen,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onDecided: () => void;
  onLater: () => void;
  onOpen: () => void;
  labels: {
    decided: string;
    later: string;
    read: string;
    unread: string;
    replied: string;
    albertTake: string;
  };
}) {
  return (
    <View style={[styles.card, item.isUnread ? styles.cardUnread : styles.cardRead]}>
      <Pressable onPress={onOpen}>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <ReadStatus item={item} labels={labels} />
            {mailboxLabel ? (
              <View style={styles.sourceChip}>
                <Text style={styles.sourceChipText}>{mailboxLabel}</Text>
              </View>
            ) : null}
            <Text style={[styles.sender, item.isUnread ? styles.senderUnread : styles.senderRead]}>
              {item.sender}
            </Text>
          </View>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.take ? (
            <Text style={styles.summaryLabel}>{labels.albertTake}</Text>
          ) : null}
          <Text style={styles.summary}>{item.summary}</Text>
          <View style={styles.tags}>
            {item.tags.map((tag) => (
              <Pill key={tag.label} label={tag.label} kind={tag.tone} mono />
            ))}
          </View>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Btn label={labels.decided} onPress={onDecided} style={styles.actionPrimary} />
        <Pressable style={styles.actionGhost} onPress={onLater}>
          <Text style={styles.actionGhostText}>{labels.later}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FyiCard({
  item,
  mailboxLabel,
  onDismiss,
  onMarkRead,
  onView,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onDismiss: () => void;
  onMarkRead: () => void;
  onView: () => void;
  labels: {
    view: string;
    dismiss: string;
    markRead: string;
    read: string;
    unread: string;
    replied: string;
  };
}) {
  return (
    <View style={[styles.card, item.isUnread ? styles.cardUnread : styles.cardRead]}>
      <Pressable onPress={onView}>
        <View style={styles.cardBody}>
          <View style={styles.cardTop}>
            <ReadStatus item={item} labels={labels} />
            {mailboxLabel ? (
              <View style={styles.sourceChip}>
                <Text style={styles.sourceChipText}>{mailboxLabel}</Text>
              </View>
            ) : null}
            <Text style={[styles.sender, item.isUnread ? styles.senderUnread : styles.senderRead]}>
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
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Pressable style={styles.actionGhost} onPress={onView}>
          <Text style={styles.actionGhostText}>{labels.view}</Text>
        </Pressable>
        {item.isUnread ? (
          <Pressable style={styles.actionGhost} onPress={onMarkRead}>
            <Text style={styles.actionGhostText}>{labels.markRead}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.actionGhost} onPress={onDismiss}>
          <Text style={styles.actionGhostText}>{labels.dismiss}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { flexGrow: 1, paddingBottom: 32 },
  scrollFill: { flexGrow: 1 },
  centeredFill: {
    flexGrow: 1,
    minHeight: 480,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
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
    borderRadius: radius.card,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    gap: 8,
  },
  cardBody: { gap: 8 },
  cardUnread: {
    borderColor: colors.accentSoft,
    backgroundColor: colors.card,
  },
  cardRead: {
    opacity: 0.88,
    backgroundColor: colors.paper2,
    borderColor: colors.hair,
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
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusUnread: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  statusReplied: {
    backgroundColor: colors.paper2,
    borderColor: colors.hair2,
  },
  statusChipText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.ink4,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  statusUnreadText: { color: colors.accent },
  statusRepliedText: { color: colors.ink3 },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  sender: { fontSize: 13, fontWeight: "600", color: colors.ink2, flex: 1 },
  senderUnread: { color: colors.ink },
  senderRead: { fontWeight: "500", color: colors.ink3 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: colors.ink },
  summaryLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink4,
  },
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
  empty: { padding: layout.padX, paddingTop: 40, alignItems: "center", gap: 8 },
  pullHint: { fontSize: 13, color: colors.ink4, textAlign: "center" },
});
