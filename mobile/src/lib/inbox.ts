import type { InboxMessage } from "@albert/shared-types";

export type AppInboxItem = {
  id: string;
  source: "email";
  sender: string;
  title: string;
  take: string;
  summary: string;
  mailboxEmail: string;
  tags: { label: string; tone: "warn" | "accent" | "muted" }[];
  section: "reply" | "fyi";
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

function needsAttention(message: InboxMessage): boolean {
  if (!message.is_unread || message.user_replied) return false;
  if (message.category === "Processing") return false;
  if (message.category === "Needs Reply" || message.category === "Needs Decision") {
    return true;
  }
  if (message.action_required && message.category !== "Waiting" && message.category !== "FYI") {
    return true;
  }
  if (message.category === "Waiting") return true;
  return false;
}

export function showsReplyActions(message: InboxMessage): boolean {
  if (!message.is_unread || message.user_replied) return false;
  return message.category === "Needs Reply" || message.category === "Needs Decision";
}

export function mapInboxMessage(message: InboxMessage): AppInboxItem {
  const section = needsAttention(message) ? "reply" : "fyi";
  return {
    id: message.id,
    source: "email",
    sender: parseSenderDisplay(message.sender),
    title: message.subject?.trim() || "(No subject)",
    take: message.take?.trim() || "",
    summary: message.take?.trim() || message.snippet?.trim() || "",
    mailboxEmail: message.mailbox_email?.trim() || "",
    tags: [tagForCategory(message.category)],
    section,
    category: message.category,
    isUnread: message.is_unread ?? true,
    userReplied: message.user_replied ?? false,
    showReplyActions: showsReplyActions(message),
  };
}
