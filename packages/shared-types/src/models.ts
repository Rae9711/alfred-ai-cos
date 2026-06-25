// DTOs mirrored from backend/app/schemas. These are the wire shapes the API returns.

import type {
  ActionStatus,
  CommitmentOwner,
  CommitmentStatus,
  Priority,
  SourceType,
  TaskStatus,
} from "./enums";

export interface TodayPriority {
  id: string;
  title: string;
  priority: Priority;
  reason: string;
  due_date: string | null; // ISO date
  counterparty: string | null;
  confidence: number;
}

export interface WaitingItem {
  id: string;
  description: string;
  person: string | null;
}

export interface MeetingToPrepare {
  id: string;
  title: string | null;
  start_time: string | null;
}

export interface TodayDashboard {
  summary: string;
  top_priorities: TodayPriority[];
  people_waiting_on_you: WaitingItem[];
  you_are_waiting_on: WaitingItem[];
  meetings_to_prepare: MeetingToPrepare[];
}

export interface UpcomingMeeting {
  id: string;
  title: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  attendees: string[];
  prep_required: boolean;
  html_link?: string | null;
}

export interface MeetingPrep {
  event: UpcomingMeeting;
  summary: string;
  open_commitments: string[];
  suggested_questions: string[];
  related_message_count: number;
}

export interface Briefing {
  id: string;
  date: string;
  summary: string;
  user_feedback: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: Priority;
  status: TaskStatus;
  source_type: SourceType;
  source_id: string | null;
}

export interface TaskCreateRequest {
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority?: Priority;
}

export interface CaptureResponse {
  tasks: Task[];
  detected_project: string | null;
}

export interface WaitingEntry {
  id: string;
  description: string;
  counterparty: string | null;
  due_date: string | null;
  age_days: number;
  source_type: SourceType;
  source_id: string | null;
}

export interface WaitingView {
  waiting_on_you: WaitingEntry[];
  you_are_waiting_on: WaitingEntry[];
}

export interface OnboardingPrefs {
  name?: string | null;
  focus?: string | null;
  optimize_for?: string | null;
  proactiveness?: string | null;
}

export interface ConnectedMailbox {
  id: string;
  email: string;
  sync_status: string;
  last_synced_at: string | null;
  gmail_modify: boolean;
}

export interface MessageReadResult {
  id: string;
  is_unread: boolean;
  gmail_synced: boolean;
}

export interface Me {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  preferences: Record<string, unknown>;
  onboarded: boolean;
  connected_mailboxes: ConnectedMailbox[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  status: string;
  useful: boolean | null;
}

export interface Commitment {
  id: string;
  description: string;
  owner: CommitmentOwner;
  counterparty: string | null;
  due_date: string | null;
  priority: Priority;
  status: CommitmentStatus;
  evidence: string | null;
  confidence: number;
}

export interface Draft {
  id: string;
  message_id: string;
  subject: string | null;
  body: string;
  tone: string;
  gmail_draft_id: string | null;
}

// A drafted reply for a Today priority/commitment (the "Act" button). Generated on
// demand from the commitment, not persisted; carries what the approval sheet renders.
export interface CommitmentDraft {
  recipient: string | null;
  subject: string;
  body: string;
  tone: string;
  evidence: string | null;
  // Set when the commitment came from an email (a real DraftReply was persisted) →
  // the reply can be SENT. Null for non-email commitments (save/review only).
  draft_reply_id: string | null;
}

// One real inbox message. `category` is one of the four UI buckets; `take` is
// Albert's one-line read of the message.
export interface InboxMessage {
  id: string;
  sender: string;
  subject: string | null;
  snippet: string | null;
  take: string | null;
  category: "Needs Reply" | "Needs Decision" | "Waiting" | "FYI" | "Processing";
  sent_at: string | null; // ISO
  action_required: boolean;
  mailbox_email: string;
  is_unread: boolean;
  user_replied: boolean;
  source?: "gmail" | "sms" | string;
  reply_phone?: string | null;
}

/** Full message body for reply drafting (fetched from Gmail on demand). */
export interface MessageDetail {
  id: string;
  sender: string;
  subject: string | null;
  snippet: string | null;
  take: string | null;
  body: string;
  category: InboxMessage["category"];
  sent_at: string | null;
  mailbox_email: string;
  source?: "gmail" | "sms" | string;
  reply_phone?: string | null;
}

export interface InboxView {
  messages: InboxMessage[];
  filtered_count: number;
  mailboxes: string[];
}

// Result of "Add to calendar" on a message: booked true if an event was created.
export interface BookMessageResponse {
  booked: boolean;
  reply: string;
  detail: string | null;
}

// Response from the Ask screen's free-text request. `action` is "booked" when a
// calendar event was created, "none" otherwise; `reply` is the line to show.
export interface AssistantAskResponse {
  reply: string;
  action: "booked" | "updated" | "cancelled" | "none";
  detail: string | null;
}

export interface DraftCreateRequest {
  message_id: string;
  tone?: string;
  instruction?: string | null;
  current_draft_body?: string | null;
  revision_history?: string[];
}

export interface ActionProposal {
  id: string;
  action_type: string;
  risk_level: number;
  reason: string | null;
  proposed_content: string | null;
  approval_required: boolean;
  strong_confirmation: boolean;
  status: ActionStatus;
}

export interface ProposeActionRequest {
  action_type: string;
  target: Record<string, unknown>;
  reason?: string | null;
}

export interface SyncResponse {
  ingested: number;
  processed: number;
  commitments_found: number;
  events_synced: number;
  initial_backfill: boolean;
}

export interface SmsForwarding {
  webhook_url: string;
  token: string;
}

export interface SessionToken {
  access_token: string;
  token_type: string;
}

export interface AuthStartResponse {
  authorization_url: string;
  state: string;
}
