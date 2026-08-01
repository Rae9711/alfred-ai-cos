// Onboarding entry (PRD 9.1). Editorial hero + Sign in with Apple (primary on iOS),
// Connect Gmail, and continue without a mailbox. Google OAuth still redirects via
// albert://auth (handled in _layout.tsx). Apple / skip mint a JWT from the API.

import { useCallback, useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api } from "@/api/client";
import { getToken, setToken } from "@/api/auth";
import {
  Btn,
  Eyebrow,
  Serif,
  inputPlaceholder,
  inputStyle,
} from "@/components/ui";
import { useLocale } from "@/context/LocaleContext";
import { colors, fonts, radius, spacing } from "@/theme/theme";

type Props = { onConnected: () => void };

function fullNameFromApple(
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
): string | null {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function friendlyError(
  e: unknown,
  fallback: string,
  networkFailed: string,
): string {
  if (!(e instanceof Error)) return fallback;
  if (
    /can't reach alfred|network request failed/i.test(e.message)
  ) {
    return networkFailed;
  }
  return e.message || fallback;
}

export function ConnectScreen({ onConnected }: Props) {
  const { t } = useLocale();
  const c = t.connect;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [devEmail, setDevEmail] = useState("zeraikiadam@gmail.com");

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    void AppleAuthentication.isAvailableAsync()
      .then(setAppleAvailable)
      .catch(() => setAppleAvailable(false));
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // The deep link to return to after Google: albert://auth in a standalone build,
      // exp://<host>/--/auth under Expo Go. createURL picks the right one per runtime,
      // so the OAuth redirect lands in whichever client is actually running.
      const returnUrl = Linking.createURL("auth");
      const { authorization_url } = await api.startGoogleAuth(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(
        authorization_url,
        returnUrl,
      );
      // openAuthSessionAsync resolves with the redirect URL when it lands; parse the
      // token directly (the global deep-link handler also catches it as a fallback).
      if (result.type === "success" && result.url) {
        const token = Linking.parse(result.url).queryParams?.token;
        if (typeof token === "string") await setToken(token);
      }
      if (await getToken()) onConnected();
    } catch (e) {
      setError(friendlyError(e, c.connectFailed, c.networkFailed));
    } finally {
      setBusy(false);
    }
  }, [c.connectFailed, c.networkFailed, onConnected]);

  const signInWithApple = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error(c.appleFailed);
      }
      const { access_token } = await api.signInWithApple({
        identity_token: credential.identityToken,
        full_name: fullNameFromApple(credential.fullName),
        email: credential.email,
      });
      await setToken(access_token);
      onConnected();
    } catch (e) {
      // User dismissed the sheet — not an error worth showing.
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        (e as { code?: string }).code === "ERR_REQUEST_CANCELED"
      ) {
        return;
      }
      setError(friendlyError(e, c.appleFailed, c.networkFailed));
    } finally {
      setBusy(false);
    }
  }, [c.appleFailed, c.networkFailed, onConnected]);

  const continueWithoutGmail = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { access_token } = await api.continueWithoutGmail();
      await setToken(access_token);
      onConnected();
    } catch (e) {
      setError(friendlyError(e, c.skipFailed, c.networkFailed));
    } finally {
      setBusy(false);
    }
  }, [c.networkFailed, c.skipFailed, onConnected]);

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
      <Eyebrow>{c.eyebrow}</Eyebrow>
      <Serif size={52} style={styles.title}>
        Alfred
      </Serif>
      <Serif size={22} color={colors.ink2} style={styles.tagline}>
        {c.tagline}
      </Serif>

      <View style={styles.ctaWrap}>
        {appleAvailable ? (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radius.pill}
            style={styles.appleButton}
            onPress={() => {
              if (!busy) void signInWithApple();
            }}
          />
        ) : null}
        <Btn
          label={busy ? c.opening : c.connectGmail}
          kind="accent"
          onPress={connect}
          disabled={busy}
        />
        <Pressable
          onPress={continueWithoutGmail}
          disabled={busy}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={c.skipGmail}
        >
          <Text style={[styles.skip, busy && styles.skipDisabled]}>
            {c.skipGmail}
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {__DEV__ ? (
        <View style={styles.devBox}>
          <Text style={styles.devLabel}>Dev login (skips OAuth)</Text>
          <TextInput
            style={[inputStyle, styles.devInput]}
            value={devEmail}
            onChangeText={setDevEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="email"
            placeholderTextColor={inputPlaceholder}
          />
          <Pressable
            style={styles.devButton}
            onPress={devLogin}
            disabled={busy}
          >
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
    backgroundColor: colors.paper,
    padding: spacing.xl,
    justifyContent: "center",
  },
  title: { marginTop: spacing.sm },
  tagline: { marginTop: spacing.md, lineHeight: 29 },
  ctaWrap: { marginTop: spacing.xl, alignSelf: "stretch", gap: spacing.md },
  appleButton: { width: "100%", height: 48 },
  skip: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink3,
    textDecorationLine: "underline",
    alignSelf: "flex-start",
  },
  skipDisabled: { opacity: 0.45 },
  error: { color: colors.warn, fontSize: 13, marginTop: spacing.sm },
  devBox: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  devLabel: { fontFamily: fonts.mono, color: colors.ink3, fontSize: 12 },
  devInput: { borderRadius: radius.sm },
  devButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  devButtonText: { color: colors.accent, fontWeight: "600" },
});
