// Connect route. Shows onboarding/sign-in; on success the auth context flips and the
// index redirect sends the user into the tabs.

import { Redirect } from "expo-router";

import { useAuth } from "@/api/AuthContext";
import { ConnectScreen } from "@/screens/ConnectScreen";

export default function Connect() {
  const { authed, refresh } = useAuth();
  if (authed) return <Redirect href="/(tabs)" />;
  return <ConnectScreen onConnected={() => void refresh()} />;
}
