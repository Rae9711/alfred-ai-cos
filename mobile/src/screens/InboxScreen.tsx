// Inbox — live Gmail messages, pixel-matched to alfred-ui-system InboxPage.

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
import { Ic } from "@/components/icons";
import { ScreenWash } from "@/components/ScreenWash";
import { useShell } from "@/components/Shell";
import { Serif } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import { useWorkflow } from "@/context/WorkflowContext";
import { useSmsShareTip } from "@/hooks/useSmsShareTip";
import type { AppInboxItem } from "@/lib/inbox";
import { statusPillFor } from "@/lib/inbox";
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
      { id: "all", label: t.inbox.filters.all },
      { id: "needs_action", label: t.inbox.filters.needsAction },
      { id: "unread", label: t.inbox.filters.unread },
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
        showToast(e instanceof Error ? e.message : t.inbox.laterFailed);
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
        showToast(e instanceof Error ? e.message : t.inbox.markReadFailed);
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
        showToast(e instanceof Error ? e.message : t.inbox.markReadFailed);
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
          <Serif size={28} display>
            {t.tabs.inbox}
          </Serif>
        </View>

        {error ? (
          <Pressable
            style={styles.errorBanner}
            onPress={() => void onPullRefresh()}
          >
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorRetry}>{t.inbox.retry}</Text>
          </Pressable>
        ) : null}

        <View style={styles.filters}>
          {mailboxTabs.map((f) => {
            const active = inboxFilter === f.id;
            return (
              <Pressable
                key={f.id}
                onPress={() => onSelectFilter(f.id)}
                style={[
                  surfaces.filterChip,
                  active && surfaces.filterChipActive,
                ]}
              >
                <Text
                  style={[
                    surfaces.filterChipText,
                    active && surfaces.filterChipTextActive,
                  ]}
                >
                  {f.label}
                  {f.id === "all" && live.length > 0 ? ` ${live.length}` : ""}
                  {f.id === "needs_action" && unreadCount > 0
                    ? ` ${unreadCount}`
                    : ""}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tabLoading ? (
          <View style={styles.tabLoading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>{t.inbox.syncing}</Text>
          </View>
        ) : null}

        <View style={styles.list}>
          {filtered.map((m) => (
            <InboxCard
              key={m.id}
              item={m}
              mailboxLabel={
                showMailboxChip && m.mailboxEmail
                  ? mailboxTabLabel(m.mailboxEmail)
                  : null
              }
              labels={{
                quickReply: t.inbox.handToAlfredReply,
                later: t.inbox.later,
                processedAction: t.inbox.markProcessed,
                markRead: t.inbox.markReadAction,
                view: t.inbox.view,
                dismiss: t.inbox.dismiss,
                decided: t.inbox.markDecided,
                openLink: t.inbox.openLink,
                needsAction: t.home.statusNeedsAction,
                done: t.home.statusDone,
                fyi: t.inbox.statusFyi,
                unread: t.inbox.unreadLabel,
              }}
              onOpen={() =>
                openMessage(
                  m.id,
                  m.section === "reply" ? "delegate" : "reply",
                )
              }
              onQuickReply={() => openMessage(m.id, "delegate")}
              onProcessed={() =>
                m.section === "decision"
                  ? markAsDecided(m.id)
                  : markAsProcessed(m.id)
              }
              onLater={() => snoozeReminder(m.id)}
              onMarkRead={() => markAsRead(m.id)}
              onDismiss={() => markAsRead(m.id)}
              onUnprocess={
                m.userDecided ? () => markAsUnprocessed(m.id) : undefined
              }
            />
          ))}
        </View>

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

        <Text style={styles.syncFooter}>
          {lastSyncedAt ? t.inbox.syncedJustNow : t.inbox.pullToSync}
        </Text>
      </ScrollView>
    </View>
  );
}

function InboxCard({
  item,
  mailboxLabel,
  labels,
  onOpen,
  onQuickReply,
  onProcessed,
  onLater,
  onMarkRead,
  onDismiss,
  onUnprocess,
}: {
  item: AppInboxItem;
  mailboxLabel: string | null;
  labels: {
    quickReply: string;
    later: string;
    processedAction: string;
    markRead: string;
    view: string;
    dismiss: string;
    decided: string;
    openLink: string;
    needsAction: string;
    done: string;
    fyi: string;
    unread: string;
  };
  onOpen: () => void;
  onQuickReply: () => void;
  onProcessed: () => void;
  onLater: () => void;
  onMarkRead: () => void;
  onDismiss: () => void;
  onUnprocess?: () => void;
}) {
  const status = statusPillFor(item, {
    needsAction: labels.needsAction,
    done: labels.done,
    fyi: labels.fyi,
    unread: labels.unread,
  });
  const tone =
    item.section === "reply"
      ? ("purple" as const)
      : item.section === "decision"
        ? ("blue" as const)
        : ("neutral" as const);
  const showActions =
    item.showReplyActions ||
    item.section === "decision" ||
    item.isUnread ||
    item.section === "fyi";

  return (
    <View style={styles.card}>
      <Pressable onPress={onOpen} style={styles.cardMain}>
        <AlfredIcon
          icon={item.source === "sms" ? Ic.Chat : Ic.Mail}
          tone={tone}
          size="medium"
        />
        <View style={styles.cardCopy}>
          <View style={styles.cardMeta}>
            <Text style={styles.sender} numberOfLines={1}>
              {item.sender}
              {mailboxLabel ? ` · ${mailboxLabel}` : ""}
            </Text>
          </View>
          <Text style={styles.subject} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.preview} numberOfLines={2}>
            {item.summary || item.take}
          </Text>
          <MessageLinks
            parts={[item.take, item.summary, item.title]}
            label={labels.openLink}
          />
        </View>
        <View
          style={[
            surfaces.statusPill,
            status.done && surfaces.statusPillDone,
            status.kind === "fyi" && styles.statusFyiPill,
            status.kind === "unread" && styles.statusUnreadPill,
            styles.statusChip,
          ]}
        >
          <Text
            style={[
              surfaces.statusPillText,
              status.done && surfaces.statusPillDoneText,
              status.kind === "fyi" && styles.statusFyiText,
              status.kind === "unread" && styles.statusUnreadText,
            ]}
          >
            {status.text}
          </Text>
        </View>
      </Pressable>

      {showActions ? (
        <View style={styles.quickActions}>
          {item.showReplyActions ? (
            <Pressable style={styles.quickBtn} onPress={onQuickReply}>
              <Ic.Mail size={12} color="#5F6470" stroke={2} />
              <Text style={styles.quickBtnText}>{labels.quickReply}</Text>
            </Pressable>
          ) : null}
          {item.section === "decision" || item.showReplyActions ? (
            <Pressable style={styles.quickBtn} onPress={onProcessed}>
              <Ic.Check size={12} color="#5F6470" stroke={2} />
              <Text style={styles.quickBtnText}>
                {item.section === "decision"
                  ? labels.decided
                  : labels.processedAction}
              </Text>
            </Pressable>
          ) : null}
          {item.section === "reply" || item.section === "decision" ? (
            <Pressable style={styles.quickBtn} onPress={onLater}>
              <Ic.Clock size={12} color="#5F6470" stroke={2} />
              <Text style={styles.quickBtnText}>{labels.later}</Text>
            </Pressable>
          ) : null}
          {item.section === "fyi" ? (
            <>
              {onUnprocess ? (
                <Pressable style={styles.quickBtn} onPress={onUnprocess}>
                  <Ic.Refresh size={12} color="#5F6470" stroke={2} />
                  <Text style={styles.quickBtnText}>{labels.processedAction}</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.quickBtn} onPress={onOpen}>
                <Text style={styles.quickBtnText}>{labels.view}</Text>
              </Pressable>
              {item.isUnread ? (
                <Pressable style={styles.quickBtn} onPress={onMarkRead}>
                  <Text style={styles.quickBtnText}>{labels.markRead}</Text>
                </Pressable>
              ) : null}
              {!onUnprocess ? (
                <Pressable style={styles.quickBtn} onPress={onDismiss}>
                  <Text style={styles.quickBtnText}>{labels.dismiss}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {item.isUnread && item.section !== "fyi" ? (
            <Pressable style={styles.quickBtn} onPress={onMarkRead}>
              <Text style={styles.quickBtnText}>{labels.markRead}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.quickBtn} onPress={onOpen}>
            <Ic.MoreHorizontal size={12} color="#5F6470" stroke={2} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: surfaces.screen,
  scrollTransparent: { flex: 1, backgroundColor: "transparent" },
  content: {
    flexGrow: 1,
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: layout.tabBarInset,
    gap: layout.gapSection,
  },
  scrollFill: { flexGrow: 1 },
  centeredFill: {
    flexGrow: 1,
    minHeight: 480,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loadingText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink3,
  },
  tabLoading: {
    paddingVertical: 48,
    alignItems: "center",
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  errorBanner: {
    padding: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.warnSoft,
  },
  errorText: { fontFamily: fonts.sans, fontSize: 13, color: colors.warn },
  errorRetry: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink3,
    marginTop: 4,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 8,
  },
  list: {
    gap: layout.gapCard,
  },
  card: {
    ...surfaces.glassCard,
    padding: layout.cardPad,
    borderRadius: 20,
  },
  cardMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  cardMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  sender: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: "#77756F",
    flex: 1,
  },
  subject: {
    fontFamily: fonts.sansSemibold,
    fontSize: 12,
    color: colors.ink,
    marginTop: 1,
  },
  preview: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 14,
    color: "#77756F",
  },
  statusChip: {
    alignSelf: "center",
    flexShrink: 0,
  },
  statusFyiPill: {
    backgroundColor: "#F0EEE9",
  },
  statusFyiText: {
    color: "#5F6470",
  },
  statusUnreadPill: {
    backgroundColor: "#F3EFFF",
  },
  statusUnreadText: {
    color: "#5D55D8",
  },
  quickActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  quickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.pill,
    backgroundColor: "#FAF7F2",
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  quickBtnText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: "#5F6470",
  },
  empty: {
    paddingTop: 40,
    alignItems: "center",
    gap: 8,
  },
  pullHint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink4,
    textAlign: "center",
  },
  syncFooter: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.ink4,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
