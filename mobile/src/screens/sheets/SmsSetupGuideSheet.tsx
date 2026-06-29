// In-app SMS forwarding setup — step-by-step only (iOS Shortcut or Android MacroDroid).

import { Image, Platform, ScrollView, Share, StyleSheet, Text, View } from "react-native";

import { Btn, Meta } from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { colors, fonts, spacing } from "@/theme/theme";

const IOS_REFERENCE = require("../../../assets/ios-sms-shortcut-reference.png");

type Props = {
  token: string | null;
  webhookUrl: string | null;
  onClose: () => void;
  onCopied?: (message: string) => void;
};

export function SmsSetupGuideSheet({
  token,
  webhookUrl,
  onClose,
  onCopied,
}: Props) {
  const { t } = useLocale();
  const g = t.smsSetupGuide;
  const isIos = Platform.OS === "ios";
  const steps = isIos ? g.iosSteps : g.androidSteps;
  const verifyItems = isIos ? g.iosVerify : g.androidVerify;

  const copyValue = async (value: string, toast: string) => {
    try {
      await Share.share({ message: value });
    } catch {
      // Share sheet dismissed — still treat as copied for UX.
    }
    onCopied?.(toast);
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>{g.title}</Text>
      <Meta style={styles.subtitle}>{isIos ? g.iosSubtitle : g.androidSubtitle}</Meta>

      {steps.map((step, index) => (
        <View key={index} style={styles.stepRow}>
          <Text style={styles.stepNum}>{index + 1}</Text>
          <Text style={styles.stepText}>{step}</Text>
        </View>
      ))}

      {isIos ? (
        <View style={styles.imageBlock}>
          <Text style={styles.imageCaption}>{g.iosReferenceCaption}</Text>
          <Image
            source={IOS_REFERENCE}
            style={styles.referenceImage}
            resizeMode="contain"
            accessibilityLabel={g.iosReferenceCaption}
          />
        </View>
      ) : null}

      <View style={styles.credentials}>
        <Text style={styles.credLabel}>{g.webhookLabel}</Text>
        <Text selectable style={styles.credMono}>
          {webhookUrl ?? "—"}
        </Text>
        {webhookUrl ? (
          <Btn
            label={g.copyWebhook}
            kind="ghost"
            tiny
            onPress={() => void copyValue(webhookUrl, g.webhookCopied)}
          />
        ) : null}

        <Text style={[styles.credLabel, styles.credSpacer]}>{g.tokenLabel}</Text>
        <Text selectable style={styles.credMono}>
          {token ?? "—"}
        </Text>
        {token ? (
          <Btn
            label={g.copyToken}
            kind="ghost"
            tiny
            onPress={() => void copyValue(token, g.tokenCopied)}
          />
        ) : null}
      </View>

      <Text style={styles.verifyTitle}>{g.verifyTitle}</Text>
      {verifyItems.map((item, index) => (
        <Text key={index} style={styles.verifyItem}>
          {"• "}
          {item}
        </Text>
      ))}

      <View style={styles.footer}>
        <Btn label={g.close} kind="accent" onPress={onClose} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 520 },
  content: { gap: 10, paddingBottom: spacing.md },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.ink,
    marginBottom: 2,
  },
  subtitle: { marginBottom: 6, lineHeight: 18 },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNum: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.accentInk,
    width: 18,
    marginTop: 2,
  },
  stepText: { flex: 1, fontSize: 14, color: colors.ink2, lineHeight: 21 },
  imageBlock: { gap: 8, marginTop: 4 },
  imageCaption: { fontSize: 12, color: colors.ink3, lineHeight: 17 },
  referenceImage: {
    width: "100%",
    height: 280,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    backgroundColor: colors.paper2,
  },
  credentials: {
    marginTop: 6,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.paper2,
    gap: 6,
  },
  credLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  credSpacer: { marginTop: 4 },
  credMono: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink,
    lineHeight: 16,
  },
  verifyTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.ink,
    marginTop: 4,
  },
  verifyItem: { fontSize: 13, color: colors.ink3, lineHeight: 19 },
  footer: { marginTop: 8 },
});
