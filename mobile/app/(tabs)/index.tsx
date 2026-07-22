// The tab container, built from plain primitives. No native navigator.
//
// Edge-to-edge bottom nav (alfred-ui-system `.bottom-nav`):
// Home · Inbox · (elevated tuxedo mascot → Alfred hub) · Chats (WeChat paste) · You.

import { useCallback, useEffect, useState, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Notifications from "expo-notifications";

import AlfredMiniAvatar from "@/components/AlfredMiniAvatar";
import { Ic } from "@/components/icons";
import { ShellProvider } from "@/components/Shell";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { LocaleProvider, useLocale } from "@/context/LocaleContext";
import { MailboxProvider, useMailbox } from "@/context/MailboxContext";
import {
  WorkflowProvider,
  type TabKey,
} from "@/context/WorkflowContext";
import {
  consumeAlfredTabRequest,
  subscribeAlfredLaunch,
} from "@/lib/alfredLaunch";
import { AlfredHubScreen } from "@/screens/AlfredHubScreen";
import { ChatsScreen } from "@/screens/ChatsScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { InboxScreen } from "@/screens/InboxScreen";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { colors, fonts, layout } from "@/theme/theme";

export default function TabsHome() {
  return (
    <LocaleProvider>
      <TabsHomeInner />
    </LocaleProvider>
  );
}

function TabsHomeInner() {
  const [tab, setTab] = useState<TabKey>("today");
  const setTabStable = useCallback((t: TabKey) => setTab(t), []);

  return (
    <MailboxProvider>
      <WorkflowProvider setTab={setTabStable}>
        <TabsChrome tab={tab} setTab={setTab} />
      </WorkflowProvider>
    </MailboxProvider>
  );
}

function TabsChrome({
  tab,
  setTab,
}: {
  tab: TabKey;
  setTab: (t: TabKey) => void;
}) {
  const { setPlacement } = useCompanionAvatar();
  const { t } = useLocale();
  const { items } = useMailbox();
  const badgeCount = items.filter(
    (m) => m.isUnread || m.section === "reply" || m.section === "decision",
  ).length;
  const atHome = tab === "inbox" || tab === "settings" || tab === "alfred";

  useEffect(() => {
    if (tab === "today") setPlacement("today");
    else if (tab === "ask") setPlacement("ask");
    else setPlacement("home");
  }, [tab, setPlacement]);

  useEffect(() => {
    const openAlfredIfRequested = () => {
      if (consumeAlfredTabRequest()) setTab("alfred");
    };
    openAlfredIfRequested();
    return subscribeAlfredLaunch(openAlfredIfRequested);
  }, [setTab]);

  useEffect(() => {
    const openFromPush = (data: unknown) => {
      const payload = data as { type?: string; deep_link?: string };
      if (payload?.type === "reminder" || payload?.type === "meeting_prep") {
        setTab("today");
        return;
      }
      if (payload?.type === "new_mail" || payload?.deep_link === "/inbox") {
        setTab("inbox");
      }
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) openFromPush(r.notification.request.content.data);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      openFromPush(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, [setTab]);

  return (
    <ShellProvider>
      <View style={styles.root}>
        <View style={styles.content}>
          {tab === "today" ? <HomeScreen /> : null}
          {tab === "inbox" ? <InboxScreen /> : null}
          {tab === "alfred" ? <AlfredHubScreen /> : null}
          {tab === "ask" ? <ChatsScreen /> : null}
          {tab === "settings" ? <SettingsScreen /> : null}
        </View>

        <View style={styles.bar} pointerEvents="box-none">
          <Tab
            label={t.tabs.today}
            active={tab === "today"}
            onPress={() => setTab("today")}
            icon={Ic.Calendar}
          />
          <Tab
            label={t.tabs.inbox}
            active={tab === "inbox"}
            onPress={() => setTab("inbox")}
            icon={Ic.Inbox}
            badge={badgeCount > 0 ? badgeCount : undefined}
          />
          <View style={styles.capture}>
            <AlfredMiniAvatar
              size={70}
              compact
              occupied={atHome}
              onPress={() => setTab("alfred")}
              accessibilityLabel={
                atHome ? t.a11y.alfredHome : t.a11y.alfredAway
              }
            />
          </View>
          <Tab
            label={t.tabs.ask}
            active={tab === "ask"}
            onPress={() => setTab("ask")}
            icon={Ic.Chat}
          />
          <Tab
            label={t.tabs.you}
            active={tab === "settings"}
            onPress={() => setTab("settings")}
            icon={Ic.User}
          />
        </View>
      </View>
    </ShellProvider>
  );
}

function Tab({
  label,
  active,
  onPress,
  icon: Icon,
  badge,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: ComponentType<{ size?: number; color?: string; stroke?: number }>;
  badge?: number;
}) {
  const color = active ? colors.accent : "#8D8B85";
  return (
    <Pressable
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
      onPress={onPress}
    >
      <View>
        <Icon size={21} color={color} stroke={2} />
        {badge != null ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {badge > 99 ? "99+" : String(badge)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.washBottom },
  content: { flex: 1 },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: layout.tabBarHeight,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingBottom: layout.homeIndicator,
    paddingTop: 5,
    borderTopWidth: 1,
    borderTopColor: "rgba(150,140,120,0.14)",
    backgroundColor: "rgba(250,247,241,0.96)",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 56,
  },
  tabPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.96 }],
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    letterSpacing: 0.1,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 999,
    backgroundColor: "#EF5D69",
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontFamily: fonts.sansSemibold,
    fontSize: 7,
    color: "#FFFFFF",
    lineHeight: 9,
  },
  capture: {
    width: 70,
    height: 70,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -34,
  },
});
