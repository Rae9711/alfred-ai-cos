// Entry route. Routes to connect (no session), onboarding (session but not yet
// calibrated), or the tabs (ready).

import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/api/AuthContext";
import { api } from "@/api/client";
import {
  readOnboardedCache,
  writeOnboardedCache,
} from "@/lib/onboardingCache";
import { colors } from "@/theme/theme";

export default function Index() {
  const { authed } = useAuth();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    void (async () => {
      // Prefer cached gate so tabs mount without a blocking /me round-trip.
      const cached = await readOnboardedCache();
      if (!cancelled && cached !== null) setOnboarded(cached);
      try {
        const me = await api.getMe();
        if (cancelled) return;
        setOnboarded(me.onboarded);
        await writeOnboardedCache(me.onboarded);
      } catch {
        if (!cancelled && cached === null) setOnboarded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  if (authed === false) return <Redirect href="/connect" />;

  if (authed === null || onboarded === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.paper,
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return onboarded ? (
    <Redirect href="/(tabs)" />
  ) : (
    <Redirect href="/onboarding" />
  );
}
