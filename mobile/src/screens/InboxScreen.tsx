// Inbox — live Gmail messages from Albert's classification pipeline.

import { useMemo } from "react";
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

import { api } from "@/api/client";
import { AlfredIcon } from "@/components/AlfredIcon";
import { IconLabel } from "@/components/IconLabel";
import { Ic } from "@/components/icons";
import { Btn, FooterStamp, Pill, Serif, SerifEm } from "@/components/ui";
import { ScreenWash } from "@/components/ScreenWash";
import { useShell } from "@/components/Shell";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { useSmsShareTip } from "@/hooks/useSmsShareTip";
import type { AppInboxItem } from "@/lib/inbox";
import { MessageLinks } from "@/components/MessageLinks";
import { MessageDetailSheet } from "@/screens/sheets/MessageDetailSheet";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";
import { surfaces } from "@/theme/surfaces";

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
    inboxFilter,
    loading,
    tabLoading,
    syncing,
    error,
    lastSyncedAt,
    syncAndRefresh,
    refresh,
    markRead,
    markDecided,
    markUndecided,
    setInboxFilter,
  } = useMailbox();
  useSmsShareTip(items);

  const mailboxTabs = useMemo(
    () => [
      { id: "needs_action", label: t.inbox.filters.needsAction },
      { id: "unread", label: t.inbox.filters.unread },
      { id: "all", label: t.inbox.filters.all },
      { id: "sms", label: t.inbox.filters.sms },
    ],
    [
      t.inbox.filters.needsAction,
      t.inbox.filters.unread,
      t.inbox.filters.all,
      t.inbox.filters.sms,
    ],
  );

  const live = tabLoading ? [] : items;

  const filtered = live;
  const replyItems = filtered.filter((m) => m.section === "reply");
  const decisionItems = filtered.filter((m) => m.section === "decision");
  const fyiItems = filtered.filter((m) => m.section === "fyi");
  const unreadCount = live.filter((m) => m.isUnread).length;
  const showMailboxChip =
    inboxFilter === "all" && inboxScope === "synced" && mailboxes.length > 1;

  const onSelectFilter = (id: string) => {
    if (id === inboxFilter || tabLoading) return;
    void setInboxFilter(id);
  };

  const snoozeReminder = (id: string) => {
    ease();
    void (async () => {
      try {
        await api.remindMessageLater(id);
        showToast(t.inbox.laterDone);
      } catch (e) {
        showToast(
          e instanceof Error ? e.message : t.inbox.laterFailed,
        );
      }
    })();
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
        showToast(e instanceof Error ? e.message : t.inbox.markReadFailed);
      }
    })();
  };

  const markAsUnprocessed = (id: string) => {
    ease();
    void (async () => {
      try {
        await markUndecided(id);
        showToast(t.inbox.markProcessedUndo);
      } catch (e) {
        showToast(e instanceof Error ? e.message : t.inbox.markReadFailed);
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
      if (inboxFilter === "sms") {
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
      <View style={styles.screen}>
        <ScreenWash />
        <ScrollView
          style={styles.scrollTransparent}
          contentContainerStyle={styles.scrollFill}
          alwaysBounceVertical
          refreshControl={refreshControl}
        >
          <View style={styles.centeredFill}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>{t.inbox.syncing}</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenWash />
      <ScrollView
        style={styles.scrollTransparent}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        alwaysBounceVertical
        refreshControl={refreshControl}
      >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Serif size={32} display>
            {t.inbox.titlePlain} <SerifEm>{t.inbox.titleEm}</SerifEm>
          </Serif>
        </View>
        <AlfredIcon
          icon={Ic.InboxFill}
          variant="dimensional"
          size="medium"
          notification={unreadCount > 0 ? unreadCount : undefined}
          label={t.tabs.inbox}
        />
      </View>

      {replyItems.length > 0 || decisionItems.length > 0 ? (
        <IconLabel
          icon={Ic.InboxFill}
          title={t.inbox.sectionReply}
          description={
            unreadCount > 0 ? t.inbox.unread(unreadCount) : undefined
          }
          style={styles.inboxLead}
        />
      ) : null}

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
            kind={inboxFilter === f.id ? "accent" : "muted"}
            mono={false}
            onPress={() => onSelectFilter(f.id)}
            style={styles.filterPill}
          />
        ))}
      </ScrollView>

      {tabLoading ? (
        <View style={styles.tabLoading}>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.loadingText}>{t.inbox.syncing}</Text>
        </View>
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
              onHandToAlfredReply={() => openMessage(m.id, "delegate")}
              onLater={() => snoozeReminder(m.id)}
              onProcessed={() => markAsProcessed(m.id)}
              onMarkRead={() => markAsRead(m.id)}
              onOpen={() => openMessage(m.id, "delegate")}
              openLinkLabel={t.inbox.openLink}
              labels={{
                handToAlfredReply: t.inbox.handToAlfredReply,
                later: t.inbox.later,
                processedAction: t.inbox.markProcessed,
                markRead: t.inbox.markReadAction,
                read: t.inbox.readLabel,
                unread: t.inbox.unreadLabel,
                replied: t.inbox.replied,
                processed: t.inbox.processed,
                alfredTake: t.inbox.alfredTake,
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
              onLater={() => snoozeReminder(m.id)}
              onOpen={() => openMessage(m.id, "reply")}
              openLinkLabel={t.inbox.openLink}
              labels={{
                decided: t.inbox.markDecided,
                later: t.inbox.later,
                read: t.inbox.readLabel,
                unread: t.inbox.unreadLabel,
                replied: t.inbox.replied,
                processed: t.inbox.processed,
                alfredTake: t.inbox.alfredTake,
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
              onDismiss={() => markAsRead(m.id)}
              onMarkRead={() => markAsRead(m.id)}
              onUnprocess={
                m.userDecided ? () => markAsUnprocessed(m.id) : undefined
              }
              onView={() => openMessage(m.id, "reply")}
              labels={{
                view: t.inbox.view,
                dismiss: t.inbox.dismiss,
                markRead: t.inbox.markReadAction,
                processed: t.inbox.markProcessed,
                read: t.inbox.readLabel,
                unread: t.inbox.unreadLabel,
                replied: t.inbox.replied,
              }}
            />
          ))}
        </Section>
      ) : null}

      {!tabLoading && filtered.length === 0 ? (
        <View style={styles.empty}>
          <Serif size={17} italic color={colors.ink3}>
            {inboxFilter === "sms"
              ? t.inbox.smsEmpty
              : inboxFilter === "needs_action"
                ? t.inbox.needsActionEmpty
                : inboxFilter === "unread"
                  ? t.inbox.unreadEmpty
                  : t.inbox.inboxZero}
          </Serif>
          <Text style={styles.pullHint}>
            {inboxFilter === "sms"
              ? t.inbox.smsEmptySub
              : inboxFilter === "needs_action"
                ? t.inbox.needsActionEmptySub
                : inboxFilter === "unread"
                  ? t.inbox.unreadEmptySub
                  : t.inbox.pullToSync}
          </Text>
        </View>
      ) : null}

      <FooterStamp text={syncFooter} />
      </ScrollView>
    </View>
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
  labels: { read: string; unread: string; replied: string; processed: string };
}) {
  if (item.userDecided) {
    return (
      <View style={[styles.statusChip, styles.statusProcessed]}>
        <Text style={[styles.statusChipText, styles.statusProcessedText]}>
          {labels.processed}
        </Text>
      </View>
    );
  }
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
  onHandToAlfredReply,
  onLater,
  onProcessed,
  onMarkRead,
  onOpen,
  openLinkLabel,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onHandToAlfredReply: () => void;
  onLater: () => void;
  onProcessed: () => void;
  onMarkRead: () => void;
  onOpen: () => void;
  openLinkLabel: string;
  labels: {
    handToAlfredReply: string;
    later: string;
    processedAction: string;
    markRead: string;
    read: string;
    unread: string;
    replied: string;
    processed: string;
    alfredTake: string;
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
            <Text style={styles.summaryLabel}>{labels.alfredTake}</Text>
          ) : null}
          <Text style={styles.summary}>{item.summary}</Text>
          <MessageLinks
            parts={[item.take, item.summary, item.title]}
            label={openLinkLabel}
          />
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
              <Btn
                label={labels.handToAlfredReply}
                onPress={onHandToAlfredReply}
                style={styles.actionPrimary}
              />
              <Pressable style={styles.actionGhost} onPress={onProcessed}>
                <Text style={styles.actionGhostText}>{labels.processedAction}</Text>
              </Pressable>
              <Pressable style={styles.actionGhost} onPress={onLater}>
                <Text style={styles.actionGhostText}>{labels.later}</Text>
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
  openLinkLabel,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onDecided: () => void;
  onLater: () => void;
  onOpen: () => void;
  openLinkLabel: string;
  labels: {
    decided: string;
    later: string;
    read: string;
    unread: string;
    replied: string;
    processed: string;
    alfredTake: string;
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
            <Text style={styles.summaryLabel}>{labels.alfredTake}</Text>
          ) : null}
          <Text style={styles.summary}>{item.summary}</Text>
          <MessageLinks
            parts={[item.take, item.summary, item.title]}
            label={openLinkLabel}
          />
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
  onUnprocess,
  onView,
  labels,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  onDismiss: () => void;
  onMarkRead: () => void;
  onUnprocess?: () => void;
  onView: () => void;
  labels: {
    view: string;
    dismiss: string;
    markRead: string;
    processed: string;
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
            <ReadStatus
              item={item}
              labels={{
                read: labels.read,
                unread: labels.unread,
                replied: labels.replied,
                processed: labels.processed,
              }}
            />
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
        {onUnprocess ? (
          <Pressable style={styles.actionGhost} onPress={onUnprocess}>
            <Text style={styles.actionGhostText}>{labels.processed}</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.actionGhost} onPress={onView}>
          <Text style={styles.actionGhostText}>{labels.view}</Text>
        </Pressable>
        {item.isUnread ? (
          <Pressable style={styles.actionGhost} onPress={onMarkRead}>
            <Text style={styles.actionGhostText}>{labels.markRead}</Text>
          </Pressable>
        ) : null}
        {!onUnprocess ? (
          <Pressable style={styles.actionGhost} onPress={onDismiss}>
            <Text style={styles.actionGhostText}>{labels.dismiss}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: surfaces.screen,
  scrollTransparent: { flex: 1, backgroundColor: "transparent" },
  content: { flexGrow: 1, paddingBottom: layout.tabBarInset },
  scrollFill: { flexGrow: 1 },
  centeredFill: {
    flexGrow: 1,
    minHeight: 480,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: { fontSize: 14, color: colors.ink3 },
  tabLoading: {
    paddingVertical: 48,
    alignItems: "center",
    gap: 12,
  },
  header: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  inboxLead: {
    marginHorizontal: layout.padX,
    marginBottom: 4,
  },
  badge: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  badgeText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.4,
    color: colors.accent,
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
    ...surfaces.sectionLabel,
    marginBottom: 2,
  },
  card: {
    ...surfaces.glassCard,
    padding: 14,
    gap: 8,
  },
  cardBody: { gap: 8 },
  cardUnread: {
    borderColor: "rgba(47,102,200,0.22)",
  },
  cardRead: {
    opacity: 0.9,
    backgroundColor: colors.glassSoft,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  sourceChip: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  sourceChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.ink3,
  },
  statusChip: {
    ...surfaces.statusPill,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusUnread: {
    backgroundColor: colors.accentSoft,
  },
  statusReplied: {
    backgroundColor: colors.paper2,
  },
  statusProcessed: {
    backgroundColor: colors.successSoft,
  },
  statusChipText: {
    ...surfaces.statusPillText,
    color: colors.ink4,
  },
  statusUnreadText: { color: colors.accent },
  statusRepliedText: { color: colors.ink3 },
  statusProcessedText: { color: colors.success },
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
