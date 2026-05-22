// Passthrough layout. The tab UI lives in (tabs)/index.tsx as a custom bar over plain
// primitives, because Expo Go SDK 54 (New Architecture) crashes on expo-router's native
// <Tabs> bar. The other (tabs)/* route files are unused for now but kept for a future
// migration back to a native tab bar in a dev build.

import { Redirect, Slot } from "expo-router";

import { useAuth } from "@/api/AuthContext";

export default function TabsLayout() {
  const { authed } = useAuth();
  if (authed === false) return <Redirect href="/connect" />;
  return <Slot />;
}
