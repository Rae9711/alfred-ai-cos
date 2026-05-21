// Settings (PRD 12.8 notification controls + 12.1 account). A10 ships notifications
// and quiet hours; A11 adds account deletion + integration revocation here.

import { useCallback, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/api/client";
import { useAuth } from "@/api/AuthContext";
import { registerForPush } from "@/api/push";
import { colors, spacing } from "@/theme/theme";

export function SettingsScreen() {
  const { signOut } = useAuth();
  const [quietHours, setQuietHours] = useState("22-07");
  const [pushOn, setPushOn] = useState<boolean | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const disconnectGoogle = useCallback(() => {
    Alert.alert(
      "Disconnect Google?",
      "Albert will lose access to your Gmail and Calendar. Your data in Albert stays.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            void api
              .disconnectAccount("google")
              .then(() => setNote("Google disconnected."))
              .catch((e: unknown) =>
                setNote(e instanceof Error ? e.message : "Disconnect failed"),
              );
          },
        },
      ],
    );
  }, []);

  const deleteAccount = useCallback(() => {
    Alert.alert(
      "Delete your account?",
      "This permanently deletes all your data and revokes Albert's access. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: () => {
            void api
              .deleteAccount()
              .then(() => signOut())
              .catch((e: unknown) =>
                setNote(e instanceof Error ? e.message : "Deletion failed"),
              );
          },
        },
      ],
    );
  }, [signOut]);

  const enablePush = useCallback(async () => {
    setNote(null);
    try {
      const ok = await registerForPush();
      setPushOn(ok);
      setNote(ok ? "Push enabled." : "Push permission denied.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not enable push");
    }
  }, []);

  const saveQuietHours = useCallback(async () => {
    setNote(null);
    try {
      await api.setQuietHours(quietHours.trim());
      setNote("Quiet hours saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save quiet hours");
    }
  }, [quietHours]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Settings</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      <Text style={styles.section}>Notifications</Text>
      <Pressable style={styles.button} onPress={() => void enablePush()}>
        <Text style={styles.buttonText}>
          {pushOn ? "Push enabled" : "Enable push notifications"}
        </Text>
      </Pressable>

      <Text style={styles.label}>Quiet hours (HH-HH)</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={quietHours}
          onChangeText={setQuietHours}
          placeholder="22-07"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
        <Pressable
          style={styles.saveButton}
          onPress={() => void saveQuietHours()}
        >
          <Text style={styles.buttonText}>Save</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Albert holds non-urgent alerts during these hours. Deadline risks still
        come through.
      </Text>

      <Text style={styles.section}>Account</Text>
      <Pressable style={styles.button} onPress={disconnectGoogle}>
        <Text style={styles.buttonText}>Disconnect Google</Text>
      </Pressable>
      <Pressable style={styles.button} onPress={() => void signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      <Pressable style={styles.dangerButton} onPress={deleteAccount}>
        <Text style={styles.dangerText}>Delete account</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 28, fontWeight: "700" },
  note: { color: colors.accent, fontSize: 13 },
  section: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  label: { color: colors.textMuted, fontSize: 13 },
  row: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  button: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  buttonText: { color: colors.text, fontWeight: "600" },
  hint: { color: colors.textMuted, fontSize: 12 },
  dangerButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#E5484D",
    borderRadius: 10,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  dangerText: { color: "#E5484D", fontWeight: "700" },
});
