// Settings (You) — pixel-matched to the prototype's ScreenSettings. Eyebrow "You",
// serif name, this-week stats, Integrations, Preferences, the L0–L4 approval ladder,
// Memory, Account. Real wiring: name/email from getMe, quiet hours, push, disconnect
// Google, sign out, delete account. Stats/memory are display-only until the backend
// exposes them (shown from getMe.preferences where available, else sensible defaults).

import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Me } from "@albert/shared-types";
import * as LinkingExpo from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api } from "@/api/client";
import { useAuth } from "@/api/AuthContext";
import { registerForPush } from "@/api/push";
import { Ic } from "@/components/icons";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import {
  Btn,
  Eyebrow,
  Meta,
  Pill,
  SectionTitle,
  Serif,
  SerifEm,
} from "@/components/ui";
import { colors, fonts, layout, spacing } from "@/theme/theme";
import {
  getContactsPermissionStatus,
  requestContactsPermission,
  type ContactsPermissionStatus,
} from "@/lib/contacts";

export function SettingsScreen() {
  const { signOut } = useAuth();
  const { locale, setLocale, t } = useLocale();
  const { syncAndRefresh } = useMailbox();
  const [me, setMe] = useState<Me | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [smsToken, setSmsToken] = useState<string | null>(null);
  const [smsShortcutUrl, setSmsShortcutUrl] = useState<string | null>(null);
  const [smsImportUrl, setSmsImportUrl] = useState<string | null>(null);
  const [smsBackfillShortcutUrl, setSmsBackfillShortcutUrl] = useState<string | null>(null);
  const [smsBackfillImportUrl, setSmsBackfillImportUrl] = useState<string | null>(null);
  const [contactsStatus, setContactsStatus] = useState<ContactsPermissionStatus | null>(
    null,
  );

  useEffect(() => {
    api
      .getMe()
      .then(setMe)
      .catch(() => setMe(null));
    api
      .getSmsForwardingInstall()
      .then((cfg) => {
        setSmsToken(cfg.token);
        setSmsShortcutUrl(cfg.shortcut_url);
        setSmsImportUrl(cfg.import_url);
      })
      .catch(() => {
        setSmsToken(null);
        setSmsShortcutUrl(null);
        setSmsImportUrl(null);
      });
    api
      .getSmsBackfillInstall()
      .then((cfg) => {
        setSmsBackfillShortcutUrl(cfg.shortcut_url);
        setSmsBackfillImportUrl(cfg.import_url);
      })
      .catch(() => {
        setSmsBackfillShortcutUrl(null);
        setSmsBackfillImportUrl(null);
      });
  }, []);

  const refreshContactsStatus = useCallback(async () => {
    try {
      setContactsStatus(await getContactsPermissionStatus());
    } catch {
      setContactsStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshContactsStatus();
  }, [refreshContactsStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refreshContactsStatus();
    });
    return () => sub.remove();
  }, [refreshContactsStatus]);

  const handleContactsPermission = useCallback(async () => {
    setNote(null);
    if (contactsStatus === "denied") {
      try {
        await Linking.openSettings();
      } catch {
        setNote(t.settings.contactsDeniedToast);
      }
      return;
    }
    try {
      const granted = await requestContactsPermission();
      await refreshContactsStatus();
      setNote(
        granted ? t.settings.contactsGrantedToast : t.settings.contactsDeniedToast,
      );
    } catch {
      setNote(t.settings.contactsDeniedToast);
    }
  }, [
    contactsStatus,
    refreshContactsStatus,
    t.settings.contactsDeniedToast,
    t.settings.contactsGrantedToast,
  ]);

  const editQuietHours = useCallback(() => {
    // iOS-only Alert.prompt; on Android fall back to a note. Saves via the real API.
    if (Alert.prompt) {
      Alert.prompt(
        "Quiet hours",
        "When should Albert hold non-urgent alerts? Format: HH-HH (e.g. 22-08).",
        (value) => {
          const v = value?.trim();
          if (!v) return;
          void api
            .setQuietHours(v)
            .then(() => api.getMe())
            .then((m) => {
              setMe(m);
              setNote(`Quiet hours set to ${v}.`);
            })
            .catch((e: unknown) =>
              setNote(e instanceof Error ? e.message : "Could not save"),
            );
        },
        "plain-text",
        "22-08",
      );
    } else {
      setNote("Quiet hours editing is available on iOS.");
    }
  }, []);

  const connectIntegration = useCallback((name: string) => {
    Alert.alert(
      `Connect ${name}`,
      `${name} integration is coming soon. Gmail and Calendar are connected today.`,
    );
  }, []);

  const refreshMe = useCallback(() => {
    void api
      .getMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const installSmsShortcut = useCallback(async () => {
    // Open the signed HTTPS .shortcut URL in Safari — iOS shows the import sheet
    // reliably. shortcuts://import-shortcut often fails from in-app Linking because
    // nested query encoding gets mangled ("the shortcut URL provided was invalid").
    const target = smsShortcutUrl ?? smsImportUrl;
    if (!target) return;
    setNote(null);
    try {
      await Linking.openURL(target);
    } catch {
      if (smsImportUrl && target !== smsImportUrl) {
        try {
          await Linking.openURL(smsImportUrl);
          return;
        } catch {
          // fall through
        }
      }
      setNote(t.settings.smsInstallFailed);
    }
  }, [smsShortcutUrl, smsImportUrl, t.settings.smsInstallFailed]);

  const openSmsBackfillShortcut = useCallback(async () => {
    const target = smsBackfillShortcutUrl ?? smsBackfillImportUrl;
    if (!target) return;
    setNote(null);
    try {
      await Linking.openURL(target);
    } catch {
      if (smsBackfillImportUrl && target !== smsBackfillImportUrl) {
        try {
          await Linking.openURL(smsBackfillImportUrl);
          return;
        } catch {
          // fall through
        }
      }
      setNote(t.settings.smsInstallFailed);
    }
  }, [smsBackfillShortcutUrl, smsBackfillImportUrl, t.settings.smsInstallFailed]);

  const copySmsToken = useCallback(async () => {
    if (!smsToken) return;
    // Share works on existing native builds; expo-clipboard needs a new binary.
    try {
      await Share.share({ message: smsToken });
      setNote(t.settings.smsTokenCopied);
    } catch {
      setNote(t.settings.smsTokenCopied);
    }
  }, [smsToken, t.settings.smsTokenCopied]);

  const linkGmail = useCallback(async () => {
    setNote(null);
    try {
      const returnUrl = LinkingExpo.createURL("settings");
      const { authorization_url } = await api.startGoogleLinkAuth(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(
        authorization_url,
        returnUrl,
      );
      if (result.type === "success" && result.url.includes("linked=1")) {
        refreshMe();
        void syncAndRefresh().catch(() => undefined);
        setNote("Gmail account linked.");
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not link Gmail");
    }
  }, [refreshMe, syncAndRefresh]);

  const disconnectMailbox = useCallback(
    (accountId: string, email: string) => {
      Alert.alert(
        t.settings.disconnectMailbox,
        email,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: t.settings.disconnectMailbox,
            style: "destructive",
            onPress: () =>
              void api
                .disconnectMailbox(accountId)
                .then(() => {
                  refreshMe();
                  void syncAndRefresh().catch(() => undefined);
                  setNote(`${email} disconnected.`);
                })
                .catch((e: unknown) =>
                  setNote(e instanceof Error ? e.message : "Disconnect failed"),
                ),
          },
        ],
      );
    },
    [refreshMe, syncAndRefresh, t.settings.disconnectMailbox],
  );

  const enablePush = useCallback(async () => {
    setNote(null);
    try {
      const ok = await registerForPush();
      setNote(ok ? "Push enabled." : "Push permission denied.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not enable push");
    }
  }, []);

  const disconnectGoogle = useCallback(() => {
    Alert.alert(
      "Disconnect Google?",
      "Albert will lose access to your Gmail and Calendar. Your data in Albert stays.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () =>
            void api
              .disconnectAccount("google")
              .then(() => setNote("Google disconnected."))
              .catch((e: unknown) =>
                setNote(e instanceof Error ? e.message : "Disconnect failed"),
              ),
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
          onPress: () =>
            void api
              .deleteAccount()
              .then(() => signOut())
              .catch((e: unknown) =>
                setNote(e instanceof Error ? e.message : "Deletion failed"),
              ),
        },
      ],
    );
  }, [signOut]);

  const name = me?.name?.trim() || "You";
  const firstName = name.split(/\s+/)[0] ?? name;
  const rest = name.slice(firstName.length);
  // Real saved quiet hours from preferences (e.g. "22-08"), or null if never set.
  const qh = me?.preferences?.["quiet_hours"];
  const quietHours = typeof qh === "string" && qh ? qh : null;
  const connectedMailboxes = me?.connected_mailboxes ?? [];
  const contactsStatusLabel =
    contactsStatus === "granted"
      ? t.settings.contactsStatusGranted
      : contactsStatus === "denied"
        ? t.settings.contactsStatusDenied
        : t.settings.contactsStatusUndetermined;
  const contactsActionLabel =
    contactsStatus === "denied"
      ? t.settings.contactsOpenSettings
      : t.settings.contactsAllow;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Eyebrow>{t.settings.you}</Eyebrow>
        <Serif size={32} style={styles.name}>
          <SerifEm>{firstName}</SerifEm>
          {rest}
        </Serif>
        <Meta>{me?.email ?? "Connected account"}</Meta>
      </View>

      {note ? <Text style={styles.note}>{note}</Text> : null}

      <SectionTitle label={t.settings.language} />
      <View style={styles.group}>
        <LanguageRow
          label={t.settings.english}
          selected={locale === "en"}
          onPress={() => setLocale("en")}
        />
        <LanguageRow
          label={t.settings.chinese}
          selected={locale === "zh"}
          onPress={() => setLocale("zh")}
          isLast
        />
      </View>
      <Meta style={styles.langHint}>{t.settings.languageDetail}</Meta>

      <SectionTitle label={t.settings.smsTitle} />
      <View style={styles.smsCard}>
        <Text style={styles.smsHint}>{t.settings.smsHint}</Text>
        <View style={styles.smsActions}>
          <Btn
            label={t.settings.smsInstallShortcut}
            kind="accent"
            tiny
            onPress={() => void installSmsShortcut()}
          />
          <Btn
            label={t.settings.smsShareShortcut}
            kind="ghost"
            tiny
            onPress={() => void openSmsBackfillShortcut()}
          />
          {smsToken ? (
            <Btn
              label={t.settings.smsCopyToken}
              kind="ghost"
              tiny
              onPress={() => void copySmsToken()}
            />
          ) : null}
        </View>
        {smsToken ? (
          <>
            <Text style={styles.smsLabel}>{t.settings.smsTokenLabel}</Text>
            <Text selectable style={styles.smsMono}>
              {smsToken}
            </Text>
          </>
        ) : null}
        <Text style={styles.smsSteps}>{t.settings.smsSteps}</Text>
      </View>

      <SectionTitle label={t.settings.contactsTitle} />
      <View style={styles.smsCard}>
        <Text style={styles.smsHint}>{t.settings.contactsHint}</Text>
        <View style={styles.contactsStatusRow}>
          <View
            style={[
              styles.contactsDot,
              contactsStatus === "granted" && styles.contactsDotGranted,
              contactsStatus === "denied" && styles.contactsDotDenied,
            ]}
          />
          <Text style={styles.contactsStatusText}>{contactsStatusLabel}</Text>
        </View>
        {contactsStatus !== "granted" ? (
          <View style={styles.smsActions}>
            <Btn
              label={contactsActionLabel}
              kind="accent"
              tiny
              onPress={() => void handleContactsPermission()}
            />
          </View>
        ) : null}
      </View>

      {/* Integrations */}
      <SectionTitle label="Integrations" />
      <Meta style={styles.langHint}>{t.settings.connectedMailboxes}</Meta>
      <View style={styles.group}>
        {connectedMailboxes.map((mailbox) => (
          <Row
            key={mailbox.id}
            label={mailbox.email}
            detail={
              mailbox.gmail_modify
                ? "Gmail · synced"
                : t.settings.reconnectForRead
            }
            onPress={() =>
              mailbox.gmail_modify
                ? disconnectMailbox(mailbox.id, mailbox.email)
                : void linkGmail()
            }
          />
        ))}
        <Integration
          name={t.settings.addGmail}
          detail="Link another inbox"
          onConnect={() => void linkGmail()}
        />
        <Integration
          name="Google Calendar"
          detail="Primary calendar"
          connected={connectedMailboxes.length > 0}
        />
        <Integration
          name="Notion"
          detail="Connect for class notes & projects"
          onConnect={() => connectIntegration("Notion")}
        />
        <Integration
          name="Todoist"
          detail="Sync existing tasks"
          isLast
          onConnect={() => connectIntegration("Todoist")}
        />
      </View>

      {/* Notifications */}
      <SectionTitle label="Notifications" />
      <View style={styles.group}>
        <Row label="Enable push" detail="" onPress={() => void enablePush()} />
        <Row
          label="Quiet hours"
          detail={quietHours ?? "Not set"}
          isLast
          onPress={editQuietHours}
        />
      </View>

      {/* Approvals & safety */}
      <SectionTitle label="Approvals & safety" />
      <View style={styles.group}>
        <ApprovalRow
          level="L0 — Read"
          desc="Summarize, classify, extract"
          req="auto"
        />
        <ApprovalRow
          level="L1 — Internal drafts"
          desc="Create drafts, propose tasks"
          req="auto"
        />
        <ApprovalRow
          level="L2 — Internal writes"
          desc="Create task, add calendar event"
          req="optional"
        />
        <ApprovalRow
          level="L3 — Send & invite"
          desc="Email someone, message, schedule"
          req="required"
        />
        <ApprovalRow
          level="L4 — Money & legal"
          desc="Purchase, payment, signed doc"
          req="strong"
          isLast
        />
      </View>

      {/* Account */}
      <SectionTitle label="Account" />
      <View style={styles.group}>
        <Row label="Disconnect Google" detail="" onPress={disconnectGoogle} />
        <Row label="Sign out" detail="" onPress={() => void signOut()} />
        <Row
          label="Delete account"
          detail=""
          warn
          isLast
          onPress={deleteAccount}
        />
      </View>

      <Meta style={styles.version}>Albert · 阿福 · made calmly</Meta>
    </ScrollView>
  );
}

function LanguageRow({
  label,
  selected,
  onPress,
  isLast = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  isLast?: boolean;
}) {
  return (
    <Pressable
      style={[styles.row, !isLast && styles.rowDivider]}
      onPress={onPress}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {selected ? (
        <View style={styles.langCheck}>
          <View style={styles.langCheckDot} />
        </View>
      ) : (
        <View style={styles.langCheckEmpty} />
      )}
    </Pressable>
  );
}

function Integration({
  name,
  detail,
  connected = false,
  isLast = false,
  onConnect,
}: {
  name: string;
  detail: string;
  connected?: boolean;
  isLast?: boolean;
  onConnect?: () => void;
}) {
  return (
    <View style={[styles.row, !isLast && styles.rowDivider]}>
      <View style={styles.intIcon}>
        <Ic.Mail size={18} color={colors.ink3} stroke={1.5} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{name}</Text>
        <Meta>{detail}</Meta>
      </View>
      {connected ? (
        <View style={styles.synced}>
          <View style={styles.syncedDot} />
          <Meta style={styles.syncedText}>Synced</Meta>
        </View>
      ) : (
        <Btn label="Connect" kind="ghost" tiny onPress={onConnect} />
      )}
    </View>
  );
}

function Row({
  label,
  detail,
  warn = false,
  isLast = false,
  onPress,
}: {
  label: string;
  detail: string;
  warn?: boolean;
  isLast?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      style={[styles.row, !isLast && styles.rowDivider]}
      onPress={onPress}
    >
      <Text
        style={[styles.rowLabel, styles.rowLabelFlex, warn && styles.warnText]}
      >
        {label}
      </Text>
      {detail ? <Meta style={styles.rowDetail}>{detail}</Meta> : null}
      <Ic.Arrow size={14} color={colors.ink4} />
    </Pressable>
  );
}

const REQ_LABEL = {
  auto: "Auto",
  optional: "Optional",
  required: "Required",
  strong: "Strong",
} as const;
const REQ_KIND = {
  auto: "muted",
  optional: "muted",
  required: "accent",
  strong: "warn",
} as const;

function ApprovalRow({
  level,
  desc,
  req,
  isLast = false,
}: {
  level: string;
  desc: string;
  req: keyof typeof REQ_LABEL;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.approvalRow, !isLast && styles.rowDivider]}>
      <View style={styles.approvalHead}>
        <Text style={styles.approvalLevel}>{level}</Text>
        <Pill label={REQ_LABEL[req]} kind={REQ_KIND[req]} />
      </View>
      <Text style={styles.approvalDesc}>{desc}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: spacing.xl,
  },
  header: { gap: 4, paddingBottom: 8 },
  name: { marginTop: 2 },
  note: { color: colors.accentInk, fontSize: 13, marginTop: spacing.sm },

  group: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 14, fontWeight: "500", color: colors.ink },
  rowLabelFlex: { flex: 1 },
  rowDetail: { marginRight: 6 },
  warnText: { color: colors.warn },

  intIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.paper2,
    alignItems: "center",
    justifyContent: "center",
  },
  synced: { flexDirection: "row", alignItems: "center", gap: 6 },
  syncedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  syncedText: { color: colors.success },

  approvalRow: { paddingVertical: 12, paddingHorizontal: 14 },
  approvalHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  approvalLevel: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink3,
    letterSpacing: 0.4,
  },
  approvalDesc: { fontSize: 13, color: colors.ink2, marginTop: 4 },

  langHint: { marginTop: 8, marginBottom: 4 },
  smsCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    padding: 14,
    gap: 10,
    marginBottom: 8,
  },
  smsHint: { fontSize: 13, color: colors.ink2, lineHeight: 19 },
  smsActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  smsLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  smsMono: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink,
    lineHeight: 16,
  },
  smsSteps: { fontSize: 12, color: colors.ink3, lineHeight: 18 },
  contactsStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.ink4,
  },
  contactsDotGranted: { backgroundColor: colors.success },
  contactsDotDenied: { backgroundColor: colors.warn },
  contactsStatusText: { fontSize: 13, fontWeight: "500", color: colors.ink2 },
  langCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  langCheckDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.paper,
  },
  langCheckEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
  },

  version: { textAlign: "center", marginTop: 24 },
});
