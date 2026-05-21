// Tab navigator. Gates auth: if no session, redirect to connect. Four tabs map to the
// Phase 1 surface: Today (home), Capture, Waiting, Settings.

import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/api/AuthContext";
import { colors } from "@/theme/theme";

export default function TabsLayout() {
  const { authed } = useAuth();
  if (authed === false) return <Redirect href="/connect" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="capture" options={{ title: "Capture" }} />
      <Tabs.Screen name="waiting" options={{ title: "Waiting" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
