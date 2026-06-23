import { StyleSheet, Text, View } from "react-native";

import type { WorkflowDraft } from "@/data/workflowDemo";
import { useLocale } from "@/context/LocaleContext";
import { Eyebrow, Serif } from "@/components/ui";
import { colors, fonts, radius, spacing } from "@/theme/theme";

export function WorkflowDraftCard({ draft }: { draft: WorkflowDraft }) {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Eyebrow>{t.ask.draftReply}</Eyebrow>
      <Text style={styles.meta}>{t.ask.draftTo(draft.to, draft.subject)}</Text>
      <Serif size={15} style={styles.body}>
        {draft.body}
      </Serif>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    padding: spacing.md,
    gap: 8,
  },
  meta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.6,
    color: colors.ink3,
    textTransform: "uppercase",
  },
  body: {
    color: colors.ink2,
    lineHeight: 22,
  },
});
