import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { ContactMatch } from "@/lib/contacts";
import { normalizePhoneInput } from "@/lib/smsComposeIntent";
import { useLocale } from "@/context/LocaleContext";
import { useShell } from "@/components/Shell";
import { Btn, Eyebrow, H2, inputPlaceholder } from "@/components/ui";
import { colors, fonts, layout, radius } from "@/theme/theme";

type Props =
  | {
      mode: "pick";
      matches: ContactMatch[];
      onSelect: (match: ContactMatch) => void;
    }
  | {
      mode: "phone";
      recipientName: string;
      onSubmit: (phone: string) => void;
    };

export function SmsComposeSheet(props: Props) {
  const { closeSheet } = useShell();
  const { t } = useLocale();
  const [phone, setPhone] = useState("");

  const finish = (fn: () => void) => {
    fn();
    closeSheet();
  };

  if (props.mode === "pick") {
    return (
      <View style={styles.sheet}>
        <Eyebrow color={colors.accent}>{t.smsCompose.pickTitle}</Eyebrow>
        <H2 style={styles.title}>{t.smsCompose.pickSubtitle}</H2>
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {props.matches.map((m) => (
            <Pressable
              key={`${m.id}-${m.phone}`}
              style={styles.row}
              onPress={() => finish(() => props.onSelect(m))}
            >
              <Text style={styles.rowName}>{m.name}</Text>
              <Text style={styles.rowPhone}>{m.phone}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  const submitPhone = () => {
    const digits = normalizePhoneInput(phone);
    if (!digits) return;
    finish(() => props.onSubmit(digits));
  };

  return (
    <View style={styles.sheet}>
      <Eyebrow color={colors.accent}>{t.smsCompose.phoneTitle}</Eyebrow>
      <H2 style={styles.title}>
        {t.smsCompose.phoneSubtitle(props.recipientName)}
      </H2>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder={t.smsCompose.phonePlaceholder}
        placeholderTextColor={inputPlaceholder}
        style={styles.input}
        keyboardType="phone-pad"
      />
      <Btn label={t.smsCompose.phoneContinue} onPress={submitPhone} />
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
  rowPhone: {
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
