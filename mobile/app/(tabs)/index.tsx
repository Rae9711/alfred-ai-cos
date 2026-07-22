// The tab container, built from plain primitives. No native navigator.
//
// Custom bottom bar: Today · Inbox · (center avatar → Alfred hub) · Chats · You.
// MailboxProvider + WorkflowProvider wire Inbox → Chat with live Gmail data.

import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Notifications from "expo-notifications";

import { CompanionAvatarHome } from "@/components/CompanionAvatar";
import { Ic } from "@/components/icons";
import { ShellProvider } from "@/components/Shell";
import { useCompanionAvatar } from "@/context/CompanionAvatarContext";
import { LocaleProvider, useLocale } from "@/context/LocaleContext";
import { MailboxProvider } from "@/context/MailboxContext";
import {
  WorkflowProvider,
  useWorkflow,
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

// CompanionAvatarProvider now lives in the root layout (app/_layout.tsx), not
// here — see T4 in docs/designs/2026-07-02-avatar-interaction-space.md.
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
  const { meta, state, setPlacement } = useCompanionAvatar();
  const { t } = useLocale();
  const { openFreeChat } = useWorkflow();
  // Alfred hub + Inbox/You: companion is "at home" on the center button.
  const atHome = tab === "inbox" || tab === "settings" || tab === "alfred";

  useEffect(() => {
    if (tab === "today") setPlacement("today");
    else if (tab === "ask") setPlacement("ask");
    else setPlacement("home"); // alfred, inbox, settings
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

        <View style={styles.bar}>
          <Tab
            label={t.tabs.today}
            active={tab === "today"}
            onPress={() => setTab("today")}
            icon={(c) => <Ic.Today size={22} color={c} stroke={1.5} />}
          />
          <Tab
            label={t.tabs.inbox}
            active={tab === "inbox"}
            onPress={() => setTab("inbox")}
            icon={(c) => <Ic.Inbox size={22} color={c} stroke={1.5} />}
          />
          <View style={styles.capture}>
            <CompanionAvatarHome
              size={54}
              color={meta.color}
              state={state}
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
            onPress={() => openFreeChat()}
            icon={(c) => <Ic.Stack size={22} color={c} stroke={1.5} />}
          />
          <Tab
            label={t.tabs.you}
            active={tab === "settings"}
            onPress={() => setTab("settings")}
            icon={(c) => <Ic.User size={22} color={c} stroke={1.5} />}
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
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: (color: string) => React.ReactNode;
}) {
  const color = active ? colors.accent : colors.ink4;
  return (
    <Pressable style={styles.tab} onPress={onPress}>
      {icon(color)}
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1 },
  bar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
    backgroundColor: colors.paper,
    paddingBottom: layout.padX + 4,
    paddingTop: 8,
    paddingHorizontal: 14,
  },
  tab: {
    alignItems: "center",
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  capture: {
    width: 58,
    height: 54,
    marginTop: -10,
    alignItems: "center",
    justifyContent: "center",
  },
});
