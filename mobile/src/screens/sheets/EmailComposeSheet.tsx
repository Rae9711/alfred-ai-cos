import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { EmailContactMatch } from "@/lib/contacts";
import { normalizeEmailInput } from "@/lib/emailComposeIntent";
import { useLocale } from "@/context/LocaleContext";
import { useShell } from "@/components/Shell";
import { Btn, Eyebrow, H2, inputPlaceholder } from "@/components/ui";
import { colors, fonts, layout, radius } from "@/theme/theme";

type Props =
  | {
      mode: "pick";
      matches: EmailContactMatch[];
      onSelect: (match: EmailContactMatch) => void;
    }
  | {
      mode: "email";
      recipientName: string;
      onSubmit: (email: string) => void;
    };

export function EmailComposeSheet(props: Props) {
  const { closeSheet } = useShell();
  const { t } = useLocale();
  const [email, setEmail] = useState("");

  const finish = (fn: () => void) => {
    fn();
    closeSheet();
  };

  if (props.mode === "pick") {
    return (
      <View style={styles.sheet}>
        <Eyebrow color={colors.accent}>{t.emailCompose.pickTitle}</Eyebrow>
        <H2 style={styles.title}>{t.emailCompose.pickSubtitle}</H2>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {props.matches.map((m) => (
            <Pressable
              key={`${m.id}-${m.email}`}
              style={styles.row}
              onPress={() => finish(() => props.onSelect(m))}
            >
              <Text style={styles.rowName}>{m.name}</Text>
              <Text style={styles.rowEmail}>{m.email}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  const submitEmail = () => {
    const normalized = normalizeEmailInput(email);
    if (!normalized) return;
    finish(() => props.onSubmit(normalized));
  };

  return (
    <View style={styles.sheet}>
      <Eyebrow color={colors.accent}>{t.emailCompose.emailTitle}</Eyebrow>
      <H2 style={styles.title}>
        {t.emailCompose.emailSubtitle(props.recipientName)}
      </H2>
      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder={t.emailCompose.emailPlaceholder}
        placeholderTextColor={inputPlaceholder}
        style={styles.input}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Btn label={t.emailCompose.emailContinue} onPress={submitEmail} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: layout.padX,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 12,
    maxHeight: "80%",
  },
  title: { marginBottom: 4 },
  list: { maxHeight: 320 },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    marginBottom: 8,
    gap: 4,
  },
  rowName: { fontSize: 16, fontWeight: "600", color: colors.ink },
  rowEmail: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink3,
  },
  input: {
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
  },
});
