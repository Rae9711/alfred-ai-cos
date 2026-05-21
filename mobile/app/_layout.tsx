// Root layout. Provides auth state and captures the albert://auth?token=... deep link
// from the OAuth callback, storing the session token and refreshing auth state.

import { useEffect } from "react";
import { Slot } from "expo-router";
import * as Linking from "expo-linking";

import { setToken } from "@/api/auth";
import { AuthProvider, useAuth } from "@/api/AuthContext";

function DeepLinkHandler() {
  const { refresh } = useAuth();

  useEffect(() => {
    const handle = async (url: string | null) => {
      if (!url) return;
      const parsed = Linking.parse(url);
      const token = parsed.queryParams?.token;
      if (parsed.path === "auth" && typeof token === "string") {
        await setToken(token);
        await refresh();
      }
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => void handle(e.url));
    return () => sub.remove();
  }, [refresh]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <DeepLinkHandler />
    </AuthProvider>
  );
}
