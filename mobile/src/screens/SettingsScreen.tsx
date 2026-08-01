// Settings (You) — cream alfred-ui-system chrome. Four shortcut tiles act as
// tabs (Personal / Preferences / Integrations / Security); only the selected
// tab's rows render below. Subscription lives under Personal. Real wiring:
// name/email from getMe, quiet hours, push, disconnect Google, sign out, delete.

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
import { useRouter } from "expo-router";

import { api } from "@/api/client";
import { useAuth } from "@/api/AuthContext";
import { registerForPush } from "@/api/push";
import AlfredMiniAvatar from "@/components/AlfredMiniAvatar";
import { AlfredIcon } from "@/components/AlfredIcon";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import { useLocale } from "@/context/LocaleContext";
import { useMailbox } from "@/context/MailboxContext";
import {
  Btn,
  Meta,
  Pill,
  SectionTitle,
  Serif,
  SerifEm,
} from "@/components/ui";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";
import { surfaces } from "@/theme/surfaces";
import { ScreenWash } from "@/components/ScreenWash";
import { translations } from "@/i18n/locales";
import { clearFreeChatHistory } from "@/lib/freeChatHistory";
import {
  getContactsPermissionStatus,
  isContactsNativeAvailable,
  requestContactsPermission,
  type ContactsPermissionStatus,
} from "@/lib/contacts";
import {
  getAppleCalendarPermissionStatus,
  isAppleCalendarNativeAvailable,
  requestAppleCalendarPermission,
  type AppleCalendarPermissionStatus,
} from "@/lib/appleCalendar";
import {
  getStoredCalendarWritePrimary,
  hydrateCalendarWritePrimaryFromMe,
  setCalendarWritePrimary,
  type CalendarWritePrimary,
} from "@/lib/calendarWrite";
import { SmsSetupGuideSheet } from "@/screens/sheets/SmsSetupGuideSheet";

type SettingsTab = "personal" | "preferences" | "integrations" | "security";

export function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { openSheet, closeSheet } = useShell();
  const { locale, setLocale, t } = useLocale();
  const s = t.settings ?? translations.en.settings;
  const { syncAndRefresh } = useMailbox();
  const [activeTab, setActiveTab] = useState<SettingsTab>("personal");
  const [me, setMe] = useState<Me | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [smsToken, setSmsToken] = useState<string | null>(null);
  const [smsWebhookUrl, setSmsWebhookUrl] = useState<string | null>(null);
  const [smsShortcutUrl, setSmsShortcutUrl] = useState<string | null>(null);
  const [smsImportUrl, setSmsImportUrl] = useState<string | null>(null);
  const [smsShareShortcutUrl, setSmsShareShortcutUrl] = useState<string | null>(
    null,
  );
  const [smsShareImportUrl, setSmsShareImportUrl] = useState<string | null>(null);
  const [contactsStatus, setContactsStatus] = useState<ContactsPermissionStatus | null>(
    null,
  );
  const [appleCalendarStatus, setAppleCalendarStatus] =
    useState<AppleCalendarPermissionStatus | null>(null);
  const [writePrimary, setWritePrimary] = useState<CalendarWritePrimary | null>(
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
      .then(async (profile) => {
        setMe(profile);
        const primary = await hydrateCalendarWritePrimaryFromMe(profile);
        setWritePrimary(primary);
      })
      .catch(() => setMe(null));
    void getStoredCalendarWritePrimary().then(setWritePrimary);
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
        setSmsShareShortcutUrl(cfg.shortcut_url);
        setSmsShareImportUrl(cfg.import_url);
      })
      .catch(() => {
        setSmsShareShortcutUrl(null);
        setSmsShareImportUrl(null);
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

  const refreshAppleCalendarStatus = useCallback(async () => {
    try {
      setAppleCalendarStatus(await getAppleCalendarPermissionStatus());
    } catch {
      setAppleCalendarStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshContactsStatus();
    void refreshAppleCalendarStatus();
  }, [refreshContactsStatus, refreshAppleCalendarStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshContactsStatus();
        void refreshAppleCalendarStatus();
      }
    });
    return () => sub.remove();
  }, [refreshContactsStatus, refreshAppleCalendarStatus]);

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

  const handleAppleCalendarPermission = useCallback(async () => {
    setNote(null);
    if (appleCalendarStatus === "denied") {
      try {
        await Linking.openSettings();
      } catch {
        setNote(s.appleCalendarDeniedToast);
      }
      return;
    }
    try {
      const granted = await requestAppleCalendarPermission();
      await refreshAppleCalendarStatus();
      setNote(granted ? s.appleCalendarGrantedToast : s.appleCalendarDeniedToast);
      if (granted && !writePrimary) {
        await setCalendarWritePrimary("apple");
        setWritePrimary("apple");
      }
    } catch {
      setNote(s.appleCalendarDeniedToast);
    }
  }, [
    appleCalendarStatus,
    refreshAppleCalendarStatus,
    s.appleCalendarDeniedToast,
    s.appleCalendarGrantedToast,
    writePrimary,
  ]);

  const chooseWritePrimary = useCallback(
    async (primary: CalendarWritePrimary) => {
      setNote(null);
      if (primary === "apple" && appleCalendarStatus !== "granted") {
        setNote(s.calendarWritePrimaryNeedApple);
        return;
      }
      if (primary === "google" && (me?.connected_mailboxes?.length ?? 0) === 0) {
        setNote(s.calendarWritePrimaryNeedGoogle);
        return;
      }
      try {
        await setCalendarWritePrimary(primary);
        setWritePrimary(primary);
        setNote(
          s.calendarWritePrimarySaved(
            primary === "apple"
              ? s.calendarWritePrimaryApple
              : s.calendarWritePrimaryGoogle,
          ),
        );
      } catch (e) {
        setNote(e instanceof Error ? e.message : "Could not save");
      }
    },
    [
      appleCalendarStatus,
      me?.connected_mailboxes?.length,
      s.calendarWritePrimaryApple,
      s.calendarWritePrimaryGoogle,
      s.calendarWritePrimaryNeedApple,
      s.calendarWritePrimaryNeedGoogle,
      s.calendarWritePrimarySaved,
    ],
  );

  const editQuietHours = useCallback(() => {
    if (Alert.prompt) {
      Alert.prompt(
        "Quiet hours",
        "When should Alfred hold non-urgent alerts? Format: HH-HH (e.g. 22-08).",
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

  const installSmsShareShortcut = useCallback(async () => {
    const target = smsShareShortcutUrl ?? smsShareImportUrl;
    if (!target) return;
    setNote(null);
    try {
      await Linking.openURL(target);
    } catch {
      if (smsShareImportUrl && target !== smsShareImportUrl) {
        try {
          await Linking.openURL(smsShareImportUrl);
          return;
        } catch {
          // fall through
        }
      }
      setNote(s.smsInstallFailed);
    }
  }, [smsShareShortcutUrl, smsShareImportUrl, s.smsInstallFailed]);

  const rotateSmsToken = useCallback(async () => {
    setNote(null);
    try {
      const cfg = await api.rotateSmsForwarding();
      setSmsToken(cfg.token);
      setSmsWebhookUrl(cfg.webhook_url);
      setNote(s.smsTokenRotated);
    } catch (e) {
      setNote(e instanceof Error ? e.message : s.smsInstallFailed);
    }
  }, [s.smsTokenRotated, s.smsInstallFailed]);

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
      "Alfred will lose access to your Gmail and Calendar. Your data in Alfred stays.",
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
      "This permanently deletes all your data and revokes Alfred's access. This cannot be undone.",
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
  const appleCalendarStatusLabel =
    appleCalendarStatus === "granted"
      ? s.appleCalendarStatusGranted
      : appleCalendarStatus === "denied"
        ? s.appleCalendarStatusDenied
        : appleCalendarStatus === "unavailable"
          ? s.appleCalendarStatusUnavailable
          : s.appleCalendarStatusUndetermined;
  const appleCalendarActionLabel =
    appleCalendarStatus === "denied"
      ? s.appleCalendarOpenSettings
      : s.appleCalendarConnect;
  const appleCalendarNativeReady = isAppleCalendarNativeAvailable();
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
    <View style={styles.screen}>
      <ScreenWash />
      <ScrollView
        style={styles.scrollTransparent}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Serif size={26} display>
            {s.you}
          </Serif>
          <Pressable style={surfaces.roundButton}>
            <Ic.Sliders size={18} color="#4B5C7C" stroke={2} />
          </Pressable>
        </View>
        <View style={styles.profileHero}>
          <AlfredMiniAvatar size={112} accessibilityLabel="Alfred" />
          <View style={styles.profileCopy}>
            <View style={styles.profileNameRow}>
              <Serif size={22} display>
                <SerifEm>{firstName}</SerifEm>
                {rest}
              </Serif>
              {isSubscribed ? (
                <View style={styles.proBadge}>
                  <Text style={styles.proBadgeText}>Pro</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.profileEmail}>
              {me?.email?.endsWith("@deferred.alfred.local")
                ? s.deferredAccount
                : (me?.email ?? "Connected account")}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.shortcutGrid}>
        {(
          [
            { id: "personal" as const, icon: Ic.User, label: s.personalInfo },
            { id: "preferences" as const, icon: Ic.Sliders, label: s.preferences },
            { id: "integrations" as const, icon: Ic.Bell, label: s.integrations },
            { id: "security" as const, icon: Ic.Shield, label: s.securityCenter },
          ] as const
        ).map((item) => {
          const selected = activeTab === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setActiveTab(item.id)}
              style={[styles.shortcutCard, selected && styles.shortcutCardActive]}
            >
              <AlfredIcon icon={item.icon} tone="blue" size="small" />
              <Text
                style={[
                  styles.shortcutLabel,
                  selected && styles.shortcutLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {note ? <Text style={styles.note}>{note}</Text> : null}

      {activeTab === "personal" ? (
        <>
          <SectionTitle label={s.personalInfo} />
          <Meta style={styles.langHint}>{s.account}</Meta>
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
                  label={s.subscriptionSubscribe}
                  kind="accent"
                  tiny
                  onPress={() => void openBillingCheckout()}
                />
              )}
            </View>
          </View>
        </>
      ) : null}

      {activeTab === "preferences" ? (
        <>
          <SectionTitle label={s.preferences} />
          <Meta style={styles.langHint}>{s.language}</Meta>
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

          <Meta style={styles.langHint}>{s.askHistoryTitle}</Meta>
          <View style={styles.group}>
            <Row
              label={s.askHistoryClear}
              detail={s.askHistoryDetail}
              isLast
              onPress={() => {
                Alert.alert(s.askHistoryClear, s.askHistoryDetail, [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: s.askHistoryClear,
                    style: "destructive",
                    onPress: () => {
                      void clearFreeChatHistory().then(() =>
                        setNote(s.askHistoryCleared),
                      );
                    },
                  },
                ]);
              }}
            />
          </View>

          <Meta style={styles.langHint}>
            {s.notificationsTitle ?? "Notifications"}
          </Meta>
          <Meta style={styles.langHint}>{s.notificationsPolicy}</Meta>
          <View style={styles.group}>
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
                        setNote(
                          e instanceof Error ? e.message : "Could not save",
                        ),
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
        </>
      ) : null}

      {activeTab === "integrations" ? (
        <>
          <SectionTitle label={s.integrations} />

          <Meta style={styles.langHint}>{s.contactsTitle}</Meta>
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
                  <Text style={styles.contactsStatusText}>
                    {contactsStatusLabel}
                  </Text>
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

          <Meta style={styles.langHint}>{s.appleCalendarTitle}</Meta>
          <View style={styles.smsCard}>
            <Text style={styles.smsHint}>{s.appleCalendarHint}</Text>
            {appleCalendarNativeReady ? (
              <>
                <View style={styles.contactsStatusRow}>
                  <View
                    style={[
                      styles.contactsDot,
                      appleCalendarStatus === "granted" &&
                        styles.contactsDotGranted,
                      appleCalendarStatus === "denied" &&
                        styles.contactsDotDenied,
                    ]}
                  />
                  <Text style={styles.contactsStatusText}>
                    {appleCalendarStatusLabel}
                  </Text>
                </View>
                {appleCalendarStatus !== "granted" ? (
                  <View style={styles.smsActions}>
                    <Btn
                      label={appleCalendarActionLabel}
                      kind="accent"
                      tiny
                      onPress={() => void handleAppleCalendarPermission()}
                    />
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.smsHint}>
                {s.appleCalendarUnavailableHint}
              </Text>
            )}
          </View>

          <Meta style={styles.langHint}>{s.calendarWritePrimaryTitle}</Meta>
          <View style={styles.smsCard}>
            <Text style={styles.smsHint}>{s.calendarWritePrimaryHint}</Text>
            <View style={styles.smsActions}>
              <Btn
                label={
                  writePrimary === "google"
                    ? `✓ ${s.calendarWritePrimaryGoogle}`
                    : s.calendarWritePrimaryGoogle
                }
                kind={writePrimary === "google" ? "accent" : "ghost"}
                tiny
                onPress={() => void chooseWritePrimary("google")}
              />
              <Btn
                label={
                  writePrimary === "apple"
                    ? `✓ ${s.calendarWritePrimaryApple}`
                    : s.calendarWritePrimaryApple
                }
                kind={writePrimary === "apple" ? "accent" : "ghost"}
                tiny
                onPress={() => void chooseWritePrimary("apple")}
              />
            </View>
          </View>

          <Meta style={styles.langHint}>{s.smsTitle}</Meta>
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
              {Platform.OS === "ios" ? (
                <Btn
                  label={s.smsInstallShareShortcut}
                  kind="ghost"
                  tiny
                  onPress={() => void installSmsShareShortcut()}
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
              {smsToken ? (
                <Btn
                  label={s.smsRotateToken}
                  kind="ghost"
                  tiny
                  onPress={() => void rotateSmsToken()}
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

          <Meta style={styles.langHint}>{s.connectedMailboxes}</Meta>
          <View style={styles.group}>
            {connectedMailboxes.map((mailbox) => {
              const needsReconnect = mailbox.sync_status === "error";
              const detail = needsReconnect
                ? s.reconnectGrant
                : mailbox.gmail_modify
                  ? "Gmail · synced"
                  : s.reconnectForRead;
              return (
                <Row
                  key={mailbox.id}
                  label={mailbox.email}
                  detail={detail}
                  onPress={() =>
                    needsReconnect || !mailbox.gmail_modify
                      ? void linkGmail()
                      : disconnectMailbox(mailbox.id, mailbox.email)
                  }
                />
              );
            })}
            <Integration
              name={s.addGmail}
              detail={
                connectedMailboxes.length === 0
                  ? s.addGmailFirstDetail
                  : s.addGmailDetail
              }
              onConnect={() => void linkGmail()}
            />
            <Integration
              name="Google Calendar"
              detail={s.googleCalendarDetail}
              connected={connectedMailboxes.length > 0}
            />
            <Integration
              name={s.appleCalendarTitle}
              detail={s.appleCalendarIntegrationDetail}
              connected={appleCalendarStatus === "granted"}
              onConnect={
                appleCalendarStatus === "granted"
                  ? undefined
                  : () => void handleAppleCalendarPermission()
              }
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

          <Meta style={styles.langHint}>{s.keyboardTitle}</Meta>
          <Meta style={styles.langHint}>{s.keyboardDetail}</Meta>
          <View style={styles.group}>
            <Row
              label={s.keyboardDiagnostics}
              detail={s.keyboardDiagnosticsDetail}
              isLast
              onPress={() => router.push("/keyboard-diagnostics" as never)}
            />
          </View>

          <Meta style={styles.langHint}>
            {s.notificationsTitle ?? "Notifications"}
          </Meta>
          <View style={styles.group}>
            <Row
              label={s.enablePush ?? "Enable push"}
              detail=""
              isLast
              onPress={() => void enablePush()}
            />
          </View>
        </>
      ) : null}

      {activeTab === "security" ? (
        <>
          <SectionTitle label={s.securityCenter} />
          <Meta style={styles.langHint}>{s.approvalsTitle}</Meta>
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
        </>
      ) : null}

      <Meta style={styles.version}>Alfred · 阿福 · made calmly</Meta>
      </ScrollView>
    </View>
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
  screen: surfaces.screen,
  scrollTransparent: { flex: 1, backgroundColor: "transparent" },
  content: {
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: layout.tabBarInset,
  },
  header: { gap: 14, paddingBottom: 8 },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  profileHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  profileCopy: { flex: 1, minWidth: 0, gap: 6 },
  profileNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  proBadge: {
    borderWidth: 1,
    borderColor: "#E0D7C8",
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  proBadgeText: {
    fontFamily: fonts.sansMedium,
    fontSize: 9,
    color: "#9B7A43",
  },
  profileEmail: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: "#77756F",
  },
  shortcutGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  shortcutCard: {
    flex: 1,
    ...surfaces.glassCard,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    gap: 8,
  },
  shortcutCardActive: {
    borderColor: colors.accent,
    backgroundColor: "#F3F7FF",
    shadowOpacity: 0.16,
  },
  shortcutLabel: {
    fontFamily: fonts.sans,
    fontSize: 9,
    color: "#4D586D",
    textAlign: "center",
  },
  shortcutLabelActive: {
    fontFamily: fonts.sansMedium,
    color: colors.accent,
  },
  name: { marginTop: 2 },
  note: { color: colors.accentInk, fontSize: 13, marginTop: spacing.sm },

  group: {
    ...surfaces.glassRowGroup,
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
  rowLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.ink,
  },
  rowLabelFlex: { flex: 1 },
  rowDetail: { marginRight: 6 },
  warnText: { color: colors.warn },

  intIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
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
    fontFamily: fonts.sansSemibold,
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  approvalDesc: { fontSize: 13, color: colors.ink2, marginTop: 4 },

  langHint: { marginTop: 8, marginBottom: 4 },
  smsCard: {
    ...surfaces.glassCard,
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
