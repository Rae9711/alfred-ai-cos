// Thin typed fetch client for the Albert API. Reads the base URL from Expo config
// and attaches the session token from secure storage.

import { captureException } from "@/lib/sentry";
import { resolveApiBaseUrl } from "@/api/apiBaseUrl";
import type {
  ActionProposal,
  AppNotification,
  AssistantAskResponse,
  AssistantChatResponse,
  AuthStartResponse,
  BookMessageResponse,
  BillingCheckout,
  Briefing,
  CaptureResponse,
  TranscribeResponse,
  Commitment,
  CommitmentDraft,
  CommitmentStatus,
  ComposeDraft,
  ComposeDraftCreateRequest,
  ConversationAnalyzeResponse,
  ConversationConfirmRequest,
  ConversationConfirmResponse,
  ConversationInboxResponse,
  Draft,
  DraftCreateRequest,
  InboxView,
  MessageDetail,
  MessageReadResult,
  Me,
  MeetingPrep,
  OnboardingPrefs,
  ParsedConversation,
  SmsForwarding,
  SmsInstallOut,
  SmsIngestResult,
  SessionToken,
  Subscription,
  SubscriptionPlan,
  SyncResponse,
  Task,
  TaskCreateRequest,
  TaskStatus,
  TodayDashboard,
  UpcomingMeeting,
  WaitingView,
} from "@albert/shared-types";

import { clearToken, getToken } from "./auth";

// Resolved per module load. resolveApiBaseUrl never falls back to localhost on
// device builds (that caused "Network request failed" on Ad Hoc installs).
const BASE_URL: string = resolveApiBaseUrl();

// Correlates a client request with the backend's structured logs (X-Request-ID). RN has
// no guaranteed crypto.randomUUID, so a v4-shaped id from Math.random is enough here.
function requestId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// The device's IANA timezone (e.g. "Europe/Paris"), via Hermes' Intl. Falls back to
// UTC if unavailable. Sent with assistant requests so booked times match the user's clock.
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// The AuthContext registers a handler so a confirmed invalid session drops the
// user back to Connect instead of looping on dead requests.
let onAuthExpired: (() => void) | null = null;
export function setOnAuthExpired(fn: (() => void) | null): void {
  onAuthExpired = fn;
}

/** Only clear Keychain after /me confirms the JWT is dead — avoids wiping a
 *  valid session when a single endpoint mis-returns 401 during startup. */
let confirmingAuth = false;
async function confirmAndClearExpiredSession(token: string): Promise<void> {
  if (confirmingAuth) return;
  confirmingAuth = true;
  try {
    const res = await fetch(`${BASE_URL}/api/v1/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "ngrok-skip-browser-warning": "true",
        "X-Request-ID": requestId(),
      },
    });
    if (res.status === 401) {
      await clearToken();
      onAuthExpired?.();
    }
  } catch {
    // Network blip while confirming — keep the local session.
  } finally {
    confirmingAuth = false;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const token = await getToken();
  const controller = new AbortController();
  const timer =
    timeoutMs != null ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${BASE_URL}/api/v1${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        // Skip ngrok's free-tier interstitial so the app gets JSON, not the warning page.
        "ngrok-skip-browser-warning": "true",
        // Correlate with backend logs; the API echoes/consumes X-Request-ID.
        "X-Request-ID": requestId(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      if (res.status === 401 && token) {
        await confirmAndClearExpiredSession(token);
      }
      // Truncate the server detail before it becomes the error message: an API error body
      // can echo email/subject fragments, and this string flows into Sentry below.
      const detail = (await res.text()).slice(0, 120);
      throw new Error(`API ${res.status}: ${detail}`);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const body = await res.text();
    if (!body) {
      return undefined as T;
    }
    return JSON.parse(body) as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("Request timed out — try again");
    }
    // RN surfaces unreachable hosts as a generic TypeError; rewrite so Connect /
    // Settings show something actionable instead of "Network request failed".
    if (
      e instanceof TypeError ||
      (e instanceof Error && /network request failed/i.test(e.message))
    ) {
      const friendly = new Error(
        `Can't reach Alfred at ${BASE_URL}. Check your connection and try again.`,
      );
      captureException(friendly);
      throw friendly;
    }
    // Report to Sentry (no-op when DSN is blank). The message is already truncated above,
    // so no raw server detail leaves the device.
    captureException(e);
    throw e;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
}

async function uploadVoiceAudio<T>(uri: string, path: string): Promise<T> {
  const token = await getToken();
  const form = new FormData();
  // React Native FormData accepts a { uri, name, type } file object.
  form.append("audio", {
    uri,
    name: "note.m4a",
    type: "audio/m4a",
  } as unknown as Blob);
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    method: "POST",
    headers: {
      "ngrok-skip-browser-warning": "true",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 160);
    if (res.status === 501) {
      throw new Error(
        "Voice input is not configured on the server yet. Set TRANSCRIPTION_PROVIDER.",
      );
    }
    if (res.status === 401) {
      onAuthExpired?.();
    }
    throw new Error(`API ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

export const api = {
  // `redirect` is the app's own deep link to return to after Google sign-in
  // (Linking.createURL("auth")): albert://auth in a build, exp://…/--/auth in Expo Go.
  startGoogleAuth: (redirect: string) =>
    request<AuthStartResponse>(
      `/auth/google/start?redirect=${encodeURIComponent(redirect)}`,
    ),
  startGoogleLinkAuth: (redirect: string) =>
    request<AuthStartResponse>(
      `/auth/google/link/start?redirect=${encodeURIComponent(redirect)}`,
    ),
  // Development only: mint a session for an already-connected account, bypassing the
  // mobile OAuth round-trip (which needs a LAN-reachable redirect URI). The backend
  // returns 404 outside ENVIRONMENT=development.
  devSession: (email: string) =>
    request<SessionToken>(
      `/auth/dev-session?email=${encodeURIComponent(email)}`,
      {
        method: "POST",
      },
    ),
  // Production-safe: create a real Albert session without linking Gmail. Mailboxes
  // can be connected later from Settings (startGoogleLinkAuth).
  continueWithoutGmail: () =>
    request<SessionToken>("/auth/continue-without-gmail", { method: "POST" }),
  // Native Sign in with Apple — identity_token from expo-apple-authentication.
  signInWithApple: (body: {
    identity_token: string;
    full_name?: string | null;
    email?: string | null;
  }) =>
    request<SessionToken>("/auth/apple", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Revoke the current session server-side (adds its jti to the denylist) so the token
  // can't be reused even before its 30-day expiry. The bearer token is attached by
  // request(); a short timeout keeps sign-out snappy even on a bad connection.
  logout: () => request<void>("/auth/logout", { method: "POST" }, 8_000),
  sync: (opts?: {
    ingestOnly?: boolean;
    calendarOnly?: boolean;
    background?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (opts?.ingestOnly) params.set("ingest_only", "true");
    if (opts?.calendarOnly) params.set("calendar_only", "true");
    if (opts?.background) params.set("background", "true");
    const q = params.toString();
    return request<SyncResponse>(
      `/sync${q ? `?${q}` : ""}`,
      { method: "POST" },
      opts?.background
        ? 15_000
        : opts?.ingestOnly || opts?.calendarOnly
          ? 45_000
          : 120_000,
    );
  },
  getToday: (locale?: "en" | "zh") =>
    request<TodayDashboard>(`/today${locale ? `?locale=${locale}` : ""}`),
  getInbox: (opts?: {
    scope?: "needs_action" | "unread" | "today" | "synced" | "sms" | "whatsapp";
    mailbox?: string;
  }) => {
    const params = new URLSearchParams();
    if (opts?.scope) params.set("scope", opts.scope);
    if (opts?.mailbox) params.set("mailbox", opts.mailbox);
    const q = params.toString();
    return request<InboxView>(`/messages${q ? `?${q}` : ""}`);
  },
  getMessage: (messageId: string) =>
    request<MessageDetail>(`/messages/${messageId}`),
  markMessageRead: (messageId: string) =>
    request<MessageReadResult>(`/messages/${messageId}/read`, {
      method: "POST",
    }),
  markMessageDecided: (messageId: string) =>
    request<MessageReadResult>(`/messages/${messageId}/decide`, {
      method: "POST",
    }),
  markMessageUndecided: (messageId: string) =>
    request<MessageReadResult>(`/messages/${messageId}/undecide`, {
      method: "POST",
    }),
  remindMessageLater: (messageId: string) =>
    request<{ task_id: string; remind_at: string; title: string }>(
      `/messages/${messageId}/remind-later`,
      { method: "POST" },
    ),
  // "Add to calendar" on a message — books it if it describes a timed event.
  bookFromMessage: (messageId: string, timezone: string) =>
    request<BookMessageResponse>(`/messages/${messageId}/book`, {
      method: "POST",
      body: JSON.stringify({ timezone }),
    }),
  // Ask Albert a free-text request ("book my calendar tomorrow 5-6pm"). Sends the
  // device timezone so "5pm" resolves to the user's wall clock, not the server default.
  ask: (text: string) =>
    request<AssistantAskResponse>("/assistant/ask", {
      method: "POST",
      body: JSON.stringify({ text, timezone: deviceTimezone() }),
    }),
  chat: (text: string, history: { role: string; content: string }[] = []) =>
    request<AssistantChatResponse>("/assistant/chat", {
      method: "POST",
      body: JSON.stringify({
        text,
        history,
        timezone: deviceTimezone(),
      }),
    }),
  getDraft: (draftId: string) => request<Draft>(`/drafts/${draftId}`),
  listCommitments: () => request<Commitment[]>("/commitments"),
  updateCommitmentStatus: (id: string, status: CommitmentStatus) =>
    request<Commitment>(`/commitments/${id}/status?status=${status}`, {
      method: "POST",
    }),
  // Smart snooze: park a commitment until a wake condition fires. `phrase`
  // accepts "monday", "tomorrow", "+3d", "next week", "until reply", or an
  // ISO date. Server returns the parsed interpretation so the UI can confirm.
  snoozeCommitment: (
    id: string,
    body: { phrase?: string; until?: string; until_reply?: boolean },
  ) =>
    request<{ commitment: Commitment; interpreted_as: string }>(
      `/commitments/${id}/snooze`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  search: (q: string, limit = 20) =>
    request<{
      query: string;
      results: Array<{
        kind: "message" | "commitment";
        id: string;
        title: string;
        snippet: string;
        sender: string | null;
        when: string | null;
        score: number;
      }>;
    }>(`/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  // Draft a reply for a Today priority ("Act"). Returns real recipient/subject/body/
  // evidence generated from the commitment, not a stored Gmail draft.
  draftForCommitment: (id: string, tone = "concise") =>
    request<CommitmentDraft>(`/commitments/${id}/draft`, {
      method: "POST",
      body: JSON.stringify({ tone }),
    }),
  createDraft: (body: DraftCreateRequest) =>
    request<Draft>("/drafts", { method: "POST", body: JSON.stringify(body) }),
  proposeDraftToGmail: (draftId: string) =>
    request<ActionProposal>(`/actions/propose-draft-to-gmail/${draftId}`, {
      method: "POST",
    }),
  // Propose SENDING a stored draft (level 3, gmail.send). Pair with approveAction.
  proposeSendDraft: (draftId: string) =>
    request<ActionProposal>(`/actions/propose-send-draft/${draftId}`, {
      method: "POST",
    }),
  composeDraft: (body: ComposeDraftCreateRequest) =>
    request<ComposeDraft>("/compose/draft", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  proposeSendCompose: (composeDraftId: string) =>
    request<ActionProposal>(`/actions/propose-send-compose/${composeDraftId}`, {
      method: "POST",
    }),
  approveAction: (actionId: string, confirm = false) =>
    request<ActionProposal>(`/actions/${actionId}/approve?confirm=${confirm}`, {
      method: "POST",
    }),
  rejectAction: (actionId: string) =>
    request<ActionProposal>(`/actions/${actionId}/reject`, { method: "POST" }),
  listPendingActions: () => request<ActionProposal[]>("/actions/pending"),
  listUpcomingMeetings: (opts?: {
    today?: boolean;
    week?: boolean;
    month?: boolean;
  }) => {
    const params = new URLSearchParams();
    if (opts?.today) params.set("today", "true");
    if (opts?.week) params.set("week", "true");
    if (opts?.month) params.set("month", "true");
    const q = params.toString();
    return request<UpcomingMeeting[]>(`/meetings/upcoming${q ? `?${q}` : ""}`);
  },
  getMeeting: (eventId: string) => request<UpcomingMeeting>(`/meetings/${eventId}`),
  updateMeeting: (
    eventId: string,
    body: {
      title?: string | null;
      start?: string | null;
      end?: string | null;
      location?: string | null;
      description?: string | null;
    },
  ) =>
    request<UpcomingMeeting>(`/meetings/${eventId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMeeting: (eventId: string) =>
    request<void>(`/meetings/${eventId}`, { method: "DELETE" }),
  getMeetingPrep: (eventId: string) =>
    request<MeetingPrep>(`/meetings/${eventId}/prep`),
  generateBriefing: () =>
    request<Briefing>("/briefings/generate", { method: "POST" }),
  getTodayBriefing: () => request<Briefing>("/briefings/today"),
  briefingFeedback: (id: string, useful: boolean) =>
    request<Briefing>(`/briefings/${id}/feedback`, {
      method: "POST",
      body: JSON.stringify({ useful }),
    }),
  createTask: (body: TaskCreateRequest) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(body) }),
  listTasks: (opts?: { upcoming?: boolean }) => {
    const q = opts?.upcoming ? "?upcoming=true" : "";
    return request<Task[]>(`/tasks${q}`);
  },
  schedulePlanningBlock: (body: {
    title: string;
    start: string;
    end: string;
    write_target?: "google" | "apple";
  }) =>
    request<{ booked: boolean; reply: string; event_id?: string | null }>(
      "/today/schedule-block",
      { method: "POST", body: JSON.stringify(body) },
    ),
  acceptScheduleProposal: (
    id: string,
    opts?: {
      timezone?: string;
      start?: string;
      end?: string;
      write_target?: "google" | "apple";
    },
  ) =>
    request<{ accepted: boolean; reply: string; event_id?: string | null }>(
      `/schedule-proposals/${id}/accept`,
      {
        method: "POST",
        body: JSON.stringify({
          timezone: opts?.timezone ?? deviceTimezone(),
          start: opts?.start,
          end: opts?.end,
          write_target: opts?.write_target,
        }),
      },
    ),
  dismissScheduleProposal: (id: string) =>
    request<{ dismissed: boolean }>(`/schedule-proposals/${id}/dismiss`, {
      method: "POST",
    }),
  dismissHabitSuggestion: (habitId: string) =>
    request<{ dismissed: boolean }>(`/today/habit-suggestions/${habitId}/dismiss`, {
      method: "POST",
    }),
  dismissPlanningSuggestion: (itemId: string) =>
    request<{ dismissed: boolean }>(`/today/planning-suggestions/${itemId}/dismiss`, {
      method: "POST",
    }),
  updateTaskStatus: (id: string, status: TaskStatus) =>
    request<Task>(`/tasks/${id}/status?status=${status}`, { method: "POST" }),
  captureText: (text: string) =>
    request<CaptureResponse>("/capture", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  parseConversation: (text: string) =>
    request<ParsedConversation>("/conversations/parse", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  analyzeConversation: (body: {
    conversation: ParsedConversation;
    goal?: string;
    tones?: string[];
    timezone?: string;
  }) =>
    request<ConversationAnalyzeResponse>("/conversations/analyze", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        timezone: body.timezone ?? deviceTimezone(),
      }),
    }),
  confirmConversationAction: (body: ConversationConfirmRequest) =>
    request<ConversationConfirmResponse>("/conversations/actions/confirm", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        timezone: body.timezone ?? deviceTimezone(),
      }),
    }),
  getConversationInbox: () =>
    request<ConversationInboxResponse>("/conversations/inbox"),
  captureVoice: (uri: string) => uploadVoiceAudio<CaptureResponse>(uri, "/capture/voice"),
  /** Speech-to-text for composer dictation — does not create tasks. */
  transcribeVoice: (uri: string) =>
    uploadVoiceAudio<TranscribeResponse>(uri, "/capture/transcribe"),
  getWaiting: () => request<WaitingView>("/waiting"),
  getMe: () => request<Me>("/me"),
  getSmsForwarding: () => request<SmsForwarding>("/me/sms-forwarding"),
  getSmsForwardingInstall: () =>
    request<SmsInstallOut>("/me/sms-forwarding/install"),
  getSmsBackfillInstall: () =>
    request<SmsInstallOut>("/me/sms-forwarding/backfill"),
  testSmsForwarding: () =>
    request<SmsIngestResult>("/me/sms-forwarding/test", { method: "POST" }),
  rotateSmsForwarding: () =>
    request<SmsForwarding>("/me/sms-forwarding/rotate", { method: "POST" }),
  submitOnboarding: (prefs: OnboardingPrefs) =>
    request<Me>("/onboarding", { method: "POST", body: JSON.stringify(prefs) }),
  registerDevice: (push_token: string, platform?: string) =>
    request<void>("/devices", {
      method: "POST",
      body: JSON.stringify({ push_token, platform }),
    }),
  listNotifications: () => request<AppNotification[]>("/notifications"),
  notificationFeedback: (id: string, useful: boolean) =>
    request<AppNotification>(`/notifications/${id}/feedback`, {
      method: "POST",
      body: JSON.stringify({ useful }),
    }),
  setQuietHours: (quiet_hours: string) =>
    request<void>("/notifications/prefs", {
      method: "POST",
      body: JSON.stringify({ quiet_hours }),
    }),
  setCalendarWritePrimary: (calendar_write_primary: "google" | "apple") =>
    request<void>("/notifications/prefs", {
      method: "POST",
      body: JSON.stringify({ calendar_write_primary }),
    }),
  disconnectAccount: (provider: string) =>
    request<void>(`/connected-accounts/provider/${provider}`, { method: "DELETE" }),
  disconnectMailbox: (accountId: string) =>
    request<void>(`/connected-accounts/${accountId}`, { method: "DELETE" }),
  deleteAccount: () => request<void>("/me", { method: "DELETE" }),
  getSubscription: () => request<Subscription>("/billing/subscription"),
  getSubscriptionPlans: () => request<SubscriptionPlan[]>("/billing/plans"),
  startBillingCheckout: (body: { success_url: string; cancel_url: string }) =>
    request<BillingCheckout>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
