// Entry route. Redirects to the tabs when authed, to connect otherwise.

import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "@/api/AuthContext";
import { colors } from "@/theme/theme";

export default function Index() {
  const { authed } = useAuth();

  if (authed === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return authed ? <Redirect href="/(tabs)" /> : <Redirect href="/connect" />;
}
