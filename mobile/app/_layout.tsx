// Root layout. Loads brand fonts (Noto Serif SC + DM Sans + IBM Plex Mono), provides auth
// state, and captures the albert://auth?token=... deep link from the OAuth callback.
// Holds the splash until fonts are ready so there's no flash of system type.

import { useEffect } from "react";
import { Slot, router } from "expo-router";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import * as Updates from "expo-updates";
import {
  useFonts,
  NotoSerifSC_500Medium,
  NotoSerifSC_600SemiBold,
  NotoSerifSC_700Bold,
} from "@expo-google-fonts/noto-serif-sc";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from "@expo-google-fonts/dm-sans";
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
} from "@expo-google-fonts/ibm-plex-mono";

import { QueryClientProvider } from "@tanstack/react-query";

import { setToken } from "@/api/auth";
import { AuthProvider, useAuth } from "@/api/AuthContext";
import { queryClient } from "@/api/queryClient";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { CompanionAvatarProvider } from "@/context/CompanionAvatarContext";
import { requestAlfredOpen } from "@/lib/alfredLaunch";
import { handleSharedTextUrl } from "@/lib/shareIntent";
import { startAppGroupHandoffListener } from "@/lib/appGroupHandoff";
import { wrapWithSentry } from "@/lib/sentry";
import { colors } from "@/theme/theme";
import { View } from "react-native";

void SplashScreen.preventAutoHideAsync();

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
        return;
      }

      // Keyboard 展开 → albert://conversation/{id} (scheme is `albert` in app.json)
      const rawPath = (parsed.path ?? "").replace(/^\//, "");
      const host = parsed.hostname ?? "";
      let conversationId: string | undefined;
      if (host === "conversation") {
        conversationId = rawPath.split("/")[0] || "pending";
      } else if (rawPath.startsWith("conversation/")) {
        conversationId = rawPath.slice("conversation/".length).split(/[/?#]/)[0] || "pending";
      } else {
        const m = url.match(/:\/\/conversation\/([^/?#]+)/);
        if (m?.[1]) conversationId = m[1];
      }
      // Shortcuts / capture: albert://capture?text=… → Alfred hub capture mode
      const isCapture =
        host === "capture" ||
        rawPath === "capture" ||
        rawPath.startsWith("capture/");
      if (isCapture) {
        const textParam = parsed.queryParams?.text;
        const text = typeof textParam === "string" ? textParam : undefined;
        requestAlfredOpen({ capture: true, text, mode: "capture" });
        router.replace("/(tabs)" as never);
        return;
      }

      if (conversationId) {
        router.push(`/conversation/${conversationId}` as never);
        return;
      }
    };

    void Linking.getInitialURL().then((url) => {
      void handle(url);
      void handleSharedTextUrl(url);
    });
    const sub = Linking.addEventListener("url", (e) => {
      void handle(e.url);
      void handleSharedTextUrl(e.url);
    });
    return () => sub.remove();
  }, [refresh]);

  // Drain keyboard-confirmed actions when returning to the app.
  useEffect(() => startAppGroupHandoffListener(), []);

  // Route push taps to the embedded deep_link (e.g. "/approvals"). Set on both the
  // foreground/background tap stream and the cold-start response.
  useEffect(() => {
    const go = (data: unknown) => {
      const link = (data as { deep_link?: unknown })?.deep_link;
      if (typeof link === "string" && link.startsWith("/")) {
        router.push(link as never);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) go(r.notification.request.content.data);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      go(r.notification.request.content.data),
    );
    return () => sub.remove();
  }, []);

  return <Slot />;
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    NotoSerifSC_500Medium,
    NotoSerifSC_600SemiBold,
    NotoSerifSC_700Bold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
  });

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  useEffect(() => {
    // Disabled: auto-reload into a bad OTA caused an unrecoverable 闪退 loop.
    // Users pull updates on the next cold start via the default expo-updates check,
    // or we re-enable explicit reload after the startup crash is fixed.
    if (!Updates.isEnabled) return;
    void (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          // Do not reloadAsync() here — apply on next launch to avoid kill-loops.
        }
      } catch {
        // Dev / Expo Go — updates not available.
      }
    })();
  }, []);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
  }

  return (
    // QueryClientProvider wraps everything so every screen (and the deep-link-reachable
    // approvals route) shares one React Query cache.
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* Hoisted from (tabs)/index.tsx (design: docs/designs/2026-07-02-avatar-
              interaction-space.md, T4). approvals.tsx is a top-level route sibling to
              (tabs), reachable directly from a cold-start push-notification deep link
              (see DeepLinkHandler above) — it needs avatar/XP access before the tab
              shell ever mounts, not after. One provider instance for the whole app. */}
          <CompanionAvatarProvider>
            <DeepLinkHandler />
          </CompanionAvatarProvider>
        </AuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

export default wrapWithSentry(RootLayout);
