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
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Me, Subscription, SubscriptionPlan } from "@albert/shared-types";
import * as LinkingExpo from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { api } from "@/api/client";
import { useAuth } from "@/api/AuthContext";
import { registerForPush } from "@/api/push";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
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
import { translations } from "@/i18n/locales";
import {
  getContactsPermissionStatus,
  isContactsNativeAvailable,
  requestContactsPermission,
  type ContactsPermissionStatus,
} from "@/lib/contacts";
import { SmsSetupGuideSheet } from "@/screens/sheets/SmsSetupGuideSheet";

export function SettingsScreen() {
  const { signOut } = useAuth();
  const { openSheet, closeSheet } = useShell();
  const { locale, setLocale, t } = useLocale();
  const s = t.settings ?? translations.en.settings;
  const { syncAndRefresh } = useMailbox();
  const [me, setMe] = useState<Me | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [smsToken, setSmsToken] = useState<string | null>(null);
  const [smsWebhookUrl, setSmsWebhookUrl] = useState<string | null>(null);
  const [smsShortcutUrl, setSmsShortcutUrl] = useState<string | null>(null);
  const [smsImportUrl, setSmsImportUrl] = useState<string | null>(null);
  const [contactsStatus, setContactsStatus] = useState<ContactsPermissionStatus | null>(
    null,
  );
  const [quietHoursDraft, setQuietHoursDraft] = useState("");
  const [editingQuietHours, setEditingQuietHours] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [billingBusy, setBillingBusy] = useState(false);

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
      .getSmsForwarding()
      .then((cfg) => {
        setSmsWebhookUrl(cfg.webhook_url);
        setSmsToken((prev) => prev ?? cfg.token);
      })
      .catch(() => setSmsWebhookUrl(null));
    api
      .getSubscription()
      .then(setSubscription)
      .catch(() => setSubscription(null));
    api
      .getSubscriptionPlans()
      .then(setPlans)
      .catch(() => setPlans([]));
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
        setNote(s.contactsDeniedToast);
      }
      return;
    }
    try {
      const granted = await requestContactsPermission();
      await refreshContactsStatus();
      setNote(granted ? s.contactsGrantedToast : s.contactsDeniedToast);
    } catch {
      setNote(s.contactsDeniedToast);
    }
  }, [
    contactsStatus,
    refreshContactsStatus,
    s.contactsDeniedToast,
    s.contactsGrantedToast,
  ]);

  const editQuietHours = useCallback(() => {
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
      const current =
        typeof me?.preferences?.["quiet_hours"] === "string"
          ? me.preferences["quiet_hours"]
          : "22-08";
      setQuietHoursDraft(current);
      setEditingQuietHours(true);
    }
  }, [me?.preferences]);

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
      setNote(s.smsInstallFailed);
    }
  }, [smsShortcutUrl, smsImportUrl, s.smsInstallFailed]);

  const openSmsSetupGuide = useCallback(() => {
    setNote(null);
    openSheet(
      <SmsSetupGuideSheet
        token={smsToken}
        webhookUrl={smsWebhookUrl}
        onClose={closeSheet}
        onCopied={(message) => setNote(message)}
      />,
    );
  }, [closeSheet, openSheet, smsToken, smsWebhookUrl]);

  const copySmsToken = useCallback(async () => {
    if (!smsToken) return;
    // Share works on existing native builds; expo-clipboard needs a new binary.
    try {
      await Share.share({ message: smsToken });
      setNote(s.smsTokenCopied);
    } catch {
      setNote(s.smsTokenCopied);
    }
  }, [smsToken, s.smsTokenCopied]);

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
        s.disconnectMailbox,
        email,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: s.disconnectMailbox,
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
    [refreshMe, syncAndRefresh, s.disconnectMailbox],
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

  const formatBillingDate = useCallback(
    (iso: string) => {
      try {
        return new Date(iso).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      } catch {
        return iso;
      }
    },
    [locale],
  );

  const subscriptionStatusLabel = useCallback(
    (status: Subscription["status"]) => {
      switch (status) {
        case "trialing":
          return s.subscriptionStatusTrialing;
        case "active":
          return s.subscriptionStatusActive;
        case "past_due":
          return s.subscriptionStatusPastDue;
        case "canceled":
          return s.subscriptionStatusCanceled;
        default:
          return s.subscriptionStatusInactive;
      }
    },
    [
      s.subscriptionStatusActive,
      s.subscriptionStatusCanceled,
      s.subscriptionStatusInactive,
      s.subscriptionStatusPastDue,
      s.subscriptionStatusTrialing,
    ],
  );

  const openBillingCheckout = useCallback(async () => {
    if (billingBusy) return;
    setNote(null);
    setBillingBusy(true);
    try {
      const returnUrl = LinkingExpo.createURL("settings");
      const { checkout_url, message } = await api.startBillingCheckout({
        success_url: `${returnUrl}?billing=success`,
        cancel_url: `${returnUrl}?billing=cancel`,
      });
      if (checkout_url) {
        const result = await WebBrowser.openAuthSessionAsync(checkout_url, returnUrl);
        if (result.type === "success") {
          const refreshed = await api.getSubscription();
          setSubscription(refreshed);
          setNote(s.subscriptionStatusActive);
        }
        return;
      }
      Alert.alert(s.subscriptionTitle, message ?? s.subscriptionComingSoon);
    } catch (e) {
      setNote(e instanceof Error ? e.message : s.subscriptionCheckoutFailed);
    } finally {
      setBillingBusy(false);
    }
  }, [
    billingBusy,
    s.subscriptionCheckoutFailed,
    s.subscriptionComingSoon,
    s.subscriptionStatusActive,
    s.subscriptionTitle,
  ]);

  const openBillingManage = useCallback(async () => {
    const url = subscription?.manage_url;
    if (!url) {
      void openBillingCheckout();
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      setNote(s.subscriptionCheckoutFailed);
    }
  }, [openBillingCheckout, s.subscriptionCheckoutFailed, subscription?.manage_url]);

  const name = me?.name?.trim() || "You";
  const firstName = name.split(/\s+/)[0] ?? name;
  const rest = name.slice(firstName.length);
  // Real saved quiet hours from preferences (e.g. "22-08"), or null if never set.
  const qh = me?.preferences?.["quiet_hours"];
  const quietHours = typeof qh === "string" && qh ? qh : null;
  const connectedMailboxes = me?.connected_mailboxes ?? [];
  const contactsStatusLabel =
    contactsStatus === "granted"
      ? s.contactsStatusGranted
      : contactsStatus === "denied"
        ? s.contactsStatusDenied
        : contactsStatus === "unavailable"
          ? s.contactsStatusUnavailable
          : s.contactsStatusUndetermined;
  const contactsActionLabel =
    contactsStatus === "denied" ? s.contactsOpenSettings : s.contactsAllow;
  const contactsNativeReady = isContactsNativeAvailable();
  const smsHint =
    Platform.OS === "ios" ? s.smsHintIos : s.smsHintAndroid;
  const proPlan = plans[0] ?? null;
  const isSubscribed =
    subscription?.status === "active" || subscription?.status === "trialing";
  const subscriptionDetail =
    subscription?.trial_ends_at && subscription.status === "trialing"
      ? s.subscriptionTrialEnds(formatBillingDate(subscription.trial_ends_at))
      : subscription?.renews_at && isSubscribed
        ? s.subscriptionRenews(formatBillingDate(subscription.renews_at))
        : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Eyebrow>{s.you}</Eyebrow>
        <Serif size={32} style={styles.name}>
          <SerifEm>{firstName}</SerifEm>
          {rest}
        </Serif>
        <Meta>{me?.email ?? "Connected account"}</Meta>
      </View>

      {note ? <Text style={styles.note}>{note}</Text> : null}

      <SectionTitle label={s.language} />
      <View style={styles.group}>
        <LanguageRow
          label={s.english}
          selected={locale === "en"}
          onPress={() => setLocale("en")}
        />
        <LanguageRow
          label={s.chinese}
          selected={locale === "zh"}
          onPress={() => setLocale("zh")}
          isLast
        />
      </View>
      <Meta style={styles.langHint}>{s.languageDetail}</Meta>

      <SectionTitle label={s.subscriptionTitle} />
      <View style={styles.smsCard}>
        <Text style={styles.subscriptionValue}>{s.subscriptionValueProp}</Text>
        <View style={styles.subscriptionHead}>
          <View style={styles.subscriptionPlanBlock}>
            <Text style={styles.smsLabel}>{s.subscriptionCurrentPlan}</Text>
            <Text style={styles.subscriptionPlanName}>
              {subscription?.plan_name ?? s.subscriptionStatusInactive}
            </Text>
            {subscriptionDetail ? (
              <Meta style={styles.subscriptionMeta}>{subscriptionDetail}</Meta>
            ) : null}
          </View>
          <Pill
            label={subscriptionStatusLabel(subscription?.status ?? "inactive")}
            kind={
              isSubscribed
                ? "accent"
                : subscription?.status === "past_due"
                  ? "warn"
                  : "muted"
            }
          />
        </View>
        {proPlan ? (
          <>
            <View style={styles.subscriptionDivider} />
            <Text style={styles.subscriptionPlanName}>
              {proPlan.name} · {proPlan.price_label}
            </Text>
            <Text style={styles.smsLabel}>{s.subscriptionIncludes}</Text>
            {proPlan.features.map((feature) => (
              <View key={feature} style={styles.subscriptionFeatureRow}>
                <View style={styles.subscriptionBullet} />
                <Text style={styles.subscriptionFeature}>{feature}</Text>
              </View>
            ))}
          </>
        ) : null}
        <View style={styles.smsActions}>
          {isSubscribed ? (
            <Btn
              label={s.subscriptionManage}
              kind="ghost"
              tiny
              onPress={() => void openBillingManage()}
            />
          ) : (
            <Btn
              label={
                subscription?.checkout_available
                  ? s.subscriptionSubscribe
                  : s.subscriptionComingSoon
              }
              kind="accent"
              tiny
              onPress={() => void openBillingCheckout()}
            />
          )}
        </View>
      </View>

      <SectionTitle label={s.smsTitle} />
      <View style={styles.smsCard}>
        <Text style={styles.smsHint}>{smsHint}</Text>
        <View style={styles.smsActions}>
          {Platform.OS === "ios" ? (
            <Btn
              label={s.smsInstallShortcut}
              kind="accent"
              tiny
              onPress={() => void installSmsShortcut()}
            />
          ) : null}
          {smsToken ? (
            <Btn
              label={s.smsCopyToken}
              kind={Platform.OS === "ios" ? "ghost" : "accent"}
              tiny
              onPress={() => void copySmsToken()}
            />
          ) : null}
          <Btn
            label={s.smsSetupGuide}
            kind="ghost"
            tiny
            onPress={openSmsSetupGuide}
          />
        </View>
        {smsToken ? (
          <>
            <Text style={styles.smsLabel}>{s.smsTokenLabel}</Text>
            <Text selectable style={styles.smsMono}>
              {smsToken}
            </Text>
          </>
        ) : (
          <Text style={styles.smsHint}>{s.smsTokenPending}</Text>
        )}
      </View>

      <SectionTitle label={s.contactsTitle} />
      <View style={styles.smsCard}>
        <Text style={styles.smsHint}>{s.contactsHint}</Text>
        {contactsNativeReady ? (
          <>
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
          </>
        ) : (
          <Text style={styles.smsHint}>{s.contactsUnavailableHint}</Text>
        )}
      </View>

      {/* Integrations */}
      <SectionTitle label="Integrations" />
      <Meta style={styles.langHint}>{s.connectedMailboxes}</Meta>
      <View style={styles.group}>
        {connectedMailboxes.map((mailbox) => (
          <Row
            key={mailbox.id}
            label={mailbox.email}
            detail={
              mailbox.gmail_modify
                ? "Gmail · synced"
                : s.reconnectForRead
            }
            onPress={() =>
              mailbox.gmail_modify
                ? disconnectMailbox(mailbox.id, mailbox.email)
                : void linkGmail()
            }
          />
        ))}
        <Integration
          name={s.addGmail}
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
      <SectionTitle label={s.notificationsTitle ?? "Notifications"} />
      <Meta style={styles.langHint}>{s.notificationsPolicy}</Meta>
      <View style={styles.group}>
        <Row label={s.enablePush ?? "Enable push"} detail="" onPress={() => void enablePush()} />
        <Row
          label={s.quietHours ?? "Quiet hours"}
          detail={quietHours ?? s.quietHoursNotSet ?? "Not set"}
          isLast={!editingQuietHours}
          onPress={editQuietHours}
        />
      </View>
      {editingQuietHours ? (
        <View style={styles.quietEditor}>
          <Text style={styles.quietHint}>
            {s.quietHoursHint ??
              "Non-urgent alerts pause during these hours (format HH-HH, e.g. 22-08)."}
          </Text>
          <TextInput
            value={quietHoursDraft}
            onChangeText={setQuietHoursDraft}
            placeholder="22-08"
            style={styles.quietInput}
            autoCapitalize="none"
          />
          <View style={styles.quietActions}>
            <Btn
              label="Save"
              kind="accent"
              tiny
              onPress={() => {
                const v = quietHoursDraft.trim();
                if (!v) return;
                void api
                  .setQuietHours(v)
                  .then(() => api.getMe())
                  .then((m) => {
                    setMe(m);
                    setEditingQuietHours(false);
                    setNote(`Quiet hours set to ${v}.`);
                  })
                  .catch((e: unknown) =>
                    setNote(e instanceof Error ? e.message : "Could not save"),
                  );
              }}
            />
            <Btn
              label="Cancel"
              kind="ghost"
              tiny
              onPress={() => setEditingQuietHours(false)}
            />
          </View>
        </View>
      ) : null}

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
  subscriptionValue: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    fontFamily: fonts.serif,
  },
  subscriptionHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  subscriptionPlanBlock: { flex: 1, minWidth: 0, gap: 2 },
  subscriptionPlanName: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.ink,
  },
  subscriptionMeta: { marginTop: 2 },
  subscriptionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hair,
  },
  subscriptionFeatureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  subscriptionBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 6,
  },
  subscriptionFeature: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink2,
  },
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
  quietEditor: {
    marginBottom: 12,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    gap: 10,
  },
  quietHint: { fontSize: 13, color: colors.ink3, lineHeight: 18 },
  quietInput: {
    fontFamily: fonts.mono,
    fontSize: 15,
    color: colors.ink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.paper,
  },
  quietActions: { flexDirection: "row", gap: 8 },

  version: { textAlign: "center", marginTop: 24 },
});
