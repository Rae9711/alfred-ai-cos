import { Pressable, StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { colors, fonts, radius } from "@/theme/theme";
import { extractUrls, urlLabel } from "@/lib/urls";

async function openInAppBrowser(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.AUTOMATIC,
  });
}

type Props = {
  parts: (string | null | undefined)[];
  label: string;
};

export function MessageLinks({ parts, label }: Props) {
  const urls = extractUrls(...parts);
  if (urls.length === 0) return null;

  return (
    <View style={styles.root}>
      {urls.map((url) => (
        <Pressable
          key={url}
          style={styles.linkBtn}
          onPress={() => void openInAppBrowser(url)}
        >
          <Text style={styles.linkLabel}>{label}</Text>
          <Text style={styles.linkUrl} numberOfLines={1}>
            {urlLabel(url)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  linkBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.paper2,
    gap: 2,
  },
  linkLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.accent,
  },
  linkUrl: { fontSize: 14, color: colors.ink2 },
});
