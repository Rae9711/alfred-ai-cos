// Onboarding entry (PRD 9.1). One-sentence value prop, then Connect Gmail.
// Opens the backend-provided Google consent URL; the backend redirects back via
// the albert://auth deep link, handled in app/_layout.tsx.

import { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";

import { api } from "@/api/client";
import { getToken, setToken } from "@/api/auth";
import { colors, spacing } from "@/theme/theme";

type Props = { onConnected: () => void };

export function ConnectScreen({ onConnected }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devEmail, setDevEmail] = useState("zeraikiadam@gmail.com");

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { authorization_url } = await api.startGoogleAuth();
      await WebBrowser.openAuthSessionAsync(authorization_url, "albert://auth");
      // The deep-link handler stores the token; re-check before advancing.
      if (await getToken()) onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Google sign-in");
    } finally {
      setBusy(false);
    }
  }, [onConnected]);

  // Development only: skip the OAuth round-trip (which needs a LAN-reachable redirect
  // on a phone) by minting a session for an already-connected account.
  const devLogin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { access_token } = await api.devSession(devEmail.trim());
      await setToken(access_token);
      onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dev login failed");
    } finally {
      setBusy(false);
    }
  }, [devEmail, onConnected]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Albert</Text>
      <Text style={styles.tagline}>
        Connect Gmail and Calendar. I will find what matters, what you are forgetting, and what
        needs action.
      </Text>
      <Pressable style={styles.button} onPress={connect} disabled={busy}>
        <Text style={styles.buttonText}>{busy ? "Opening…" : "Connect Gmail"}</Text>
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {__DEV__ ? (
        <View style={styles.devBox}>
          <Text style={styles.devLabel}>Dev login (skips OAuth)</Text>
          <TextInput
            style={styles.devInput}
            value={devEmail}
            onChangeText={setDevEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="email"
            placeholderTextColor={colors.textMuted}
          />
          <Pressable style={styles.devButton} onPress={devLogin} disabled={busy}>
            <Text style={styles.devButtonText}>Dev sign in</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    justifyContent: "center",
    gap: spacing.lg,
  },
  title: { color: colors.text, fontSize: 40, fontWeight: "800" },
  tagline: { color: colors.textMuted, fontSize: 16, lineHeight: 24 },
  button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: spacing.md, alignItems: "center" },
  buttonText: { color: "#0E0F12", fontSize: 16, fontWeight: "700" },
  error: { color: "#E5484D", fontSize: 13 },
  devBox: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    gap: spacing.sm,
  },
  devLabel: { color: colors.textMuted, fontSize: 12 },
  devInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  devButton: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  devButtonText: { color: colors.accent, fontWeight: "600" },
});
