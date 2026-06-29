// Thin typed fetch client for the Albert API. Reads the base URL from Expo config
// and attaches the session token from secure storage.

import Constants from "expo-constants";
import { Platform } from "react-native";
import type {
  ActionProposal,
  AppNotification,
  AssistantAskResponse,
  AssistantChatResponse,
  AuthStartResponse,
  BookMessageResponse,
  Briefing,
  CaptureResponse,
  Commitment,
  CommitmentDraft,
  CommitmentStatus,
  Draft,
  DraftCreateRequest,
  InboxView,
  MessageDetail,
  MessageReadResult,
  Me,
  MeetingPrep,
  OnboardingPrefs,
  SmsForwarding,
  SmsInstallOut,
  SmsIngestResult,
  SessionToken,
  SyncResponse,
  Task,
  TaskCreateRequest,
  TaskStatus,
  TodayDashboard,
  UpcomingMeeting,
  WaitingView,
} from "@albert/shared-types";

import { clearToken, getToken } from "./auth";

/**
 * API base URL resolution:
 *   • Native (Expo Go / device): production URL from app.json `extra.apiBaseUrl`.
 *   • Web dev: localhost:8000 — requests go through `scripts/dev-api-proxy.mjs`
 *     which adds CORS headers and forwards to production. The browser blocks
 *     direct cross-origin calls to albert.alfredassistants.com, so the proxy
 *     is the only way to dev against prod from Expo web without setting up a
 *     full local backend.
 *   • Fallback: localhost:8000 for native against a local backend.
 */
function resolveBaseUrl(): string {
  if (Platform.OS === "web" && __DEV__) {
    return "http://localhost:8000";
  }
  return (
    (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
    "http://localhost:8000"
  );
}

const BASE_URL: string = resolveBaseUrl();

// The device's IANA timezone (e.g. "Europe/Paris"), via Hermes' Intl. Falls back to
// UTC if unavailable. Sent with assistant requests so booked times match the user's clock.
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// The AuthContext registers a handler so a 401 (expired/invalid token, or a rotated
// server secret) drops the user back to Connect instead of looping on dead requests.
let onAuthExpired: (() => void) | null = null;
export function setOnAuthExpired(fn: (() => void) | null): void {
  onAuthExpired = fn;
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
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) {
      // A 401 while we hold a token means it's no longer valid — clear it and bounce to
      // Connect so the user (and friends) re-auth cleanly instead of looping on 401s.
      if (res.status === 401 && token) {
        await clearToken();
        onAuthExpired?.();
      }
      const detail = await res.text();
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
    throw e;
  } finally {
    if (timer != null) clearTimeout(timer);
  }
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
  getToday: () => request<TodayDashboard>("/today"),
  getInbox: (opts?: {
    scope?: "needs_action" | "unread" | "today" | "synced" | "sms";
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
  schedulePlanningBlock: (body: { title: string; start: string; end: string }) =>
    request<{ booked: boolean; reply: string; event_id?: string | null }>(
      "/today/schedule-block",
      { method: "POST", body: JSON.stringify(body) },
    ),
  updateTaskStatus: (id: string, status: TaskStatus) =>
    request<Task>(`/tasks/${id}/status?status=${status}`, { method: "POST" }),
  captureText: (text: string) =>
    request<CaptureResponse>("/capture", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  captureVoice: async (uri: string): Promise<CaptureResponse> => {
    const token = await getToken();
    const form = new FormData();
    // React Native FormData accepts a { uri, name, type } file object.
    form.append("audio", {
      uri,
      name: "note.m4a",
      type: "audio/m4a",
    } as unknown as Blob);
    const res = await fetch(`${BASE_URL}/api/v1/capture/voice`, {
      method: "POST",
      headers: {
        "ngrok-skip-browser-warning": "true",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
    });
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return (await res.json()) as CaptureResponse;
  },
  getWaiting: () => request<WaitingView>("/waiting"),
  getMe: () => request<Me>("/me"),
  getSmsForwarding: () => request<SmsForwarding>("/me/sms-forwarding"),
  getSmsForwardingInstall: () =>
    request<SmsInstallOut>("/me/sms-forwarding/install"),
  getSmsBackfillInstall: () =>
    request<SmsInstallOut>("/me/sms-forwarding/backfill"),
  testSmsForwarding: () =>
    request<SmsIngestResult>("/me/sms-forwarding/test", { method: "POST" }),
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
  disconnectAccount: (provider: string) =>
    request<void>(`/connected-accounts/provider/${provider}`, { method: "DELETE" }),
  disconnectMailbox: (accountId: string) =>
    request<void>(`/connected-accounts/${accountId}`, { method: "DELETE" }),
  deleteAccount: () => request<void>("/me", { method: "DELETE" }),
};
