// Capture deep link → Alfred hub capture mode.
// Keeps Shortcuts working: `albert://capture?text=...` still lands in capture
// with prefilled text, now inside the Alfred tab instead of a standalone forever page.

import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { requestAlfredOpen } from "@/lib/alfredLaunch";
import { colors } from "@/theme/theme";

export default function Capture() {
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string }>();
  const initialText = typeof params.text === "string" ? params.text : undefined;

  useEffect(() => {
    requestAlfredOpen({
      capture: true,
      text: initialText,
      mode: "capture",
    });
    router.replace("/(tabs)" as never);
  }, [initialText, router]);

  return <View style={{ flex: 1, backgroundColor: colors.paper }} />;
}
