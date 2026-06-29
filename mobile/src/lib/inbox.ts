import type { InboxMessage } from "@albert/shared-types";

export type AppInboxItem = {
  id: string;
  source: "email" | "sms";
  sender: string;
  title: string;
  take: string;
  summary: string;
  mailboxEmail: string;
  replyPhone: string | null;
  tags: { label: string; tone: "warn" | "accent" | "muted" }[];
  section: "reply" | "decision" | "fyi";
  category: InboxMessage["category"];
  isUnread: boolean;
  userReplied: boolean;
  showReplyActions: boolean;
};

/** Strip `Name <email>` down to a display name. */
export function parseSenderDisplay(sender: string): string {
  const angle = sender.match(/^([^<]+)</);
  if (angle) return angle[1]!.trim().replace(/^"|"$/g, "");
  const at = sender.indexOf("@");
  if (at > 0) return sender.slice(0, at);
  return sender;
}

function tagForCategory(
  category: InboxMessage["category"],
): { label: string; tone: "warn" | "accent" | "muted" } {
  switch (category) {
    case "Needs Reply":
      return { label: category, tone: "warn" };
    case "Needs Decision":
      return { label: category, tone: "accent" };
    case "Waiting":
      return { label: category, tone: "muted" };
    case "Processing":
      return { label: category, tone: "muted" };
    default:
      return { label: category, tone: "muted" };
  }
}

/** Resolve category for display/sectioning (backend may still say Processing). */
function resolvedCategory(message: InboxMessage): InboxMessage["category"] {
  if (message.category === "Processing" && message.action_required) {
    return "Needs Reply";
  }
  return message.category;
}

function needsAttention(message: InboxMessage): boolean {
  if (message.user_replied) return false;
  const category = resolvedCategory(message);
  if (category === "Processing") return false;
  return category === "Needs Reply" || category === "Needs Decision";
}

export function isNeedsDecision(message: InboxMessage): boolean {
  return resolvedCategory(message) === "Needs Decision";
}

export function showsReplyActions(message: InboxMessage): boolean {
  if (message.user_replied) return false;
  return resolvedCategory(message) === "Needs Reply";
}

export function mapInboxMessage(message: InboxMessage): AppInboxItem {
  const section: AppInboxItem["section"] = isNeedsDecision(message)
    ? "decision"
    : needsAttention(message)
      ? "reply"
      : "fyi";
  const isSms = message.source === "sms";
  const category = resolvedCategory(message);
  const tags = isSms
    ? ([
        { label: "SMS", tone: "accent" as const },
        tagForCategory(category),
      ] as AppInboxItem["tags"])
    : ([tagForCategory(category)] as AppInboxItem["tags"]);
  return {
    id: message.id,
    source: isSms ? "sms" : "email",
    sender: parseSenderDisplay(message.sender),
    title: isSms
      ? message.snippet?.trim() || message.take?.trim() || "Text message"
      : message.subject?.trim() || "(No subject)",
    take: message.take?.trim() || "",
    summary: message.take?.trim() || message.snippet?.trim() || "",
    mailboxEmail: message.mailbox_email?.trim() || "",
    replyPhone: message.reply_phone?.trim() || null,
    tags,
    section,
    category,
    isUnread: message.is_unread ?? true,
    userReplied: message.user_replied ?? false,
    showReplyActions: showsReplyActions(message),
  };
}
