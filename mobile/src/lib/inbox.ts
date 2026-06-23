import type { InboxMessage } from "@albert/shared-types";

export type AppInboxItem = {
  id: string;
  source: "email";
  sender: string;
  title: string;
  summary: string;
  tags: { label: string; tone: "warn" | "accent" | "muted" }[];
  section: "reply" | "fyi";
  category: InboxMessage["category"];
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
    default:
      return { label: category, tone: "muted" };
  }
}

export function mapInboxMessage(message: InboxMessage): AppInboxItem {
  const section =
    message.category === "Needs Reply" || message.category === "Needs Decision"
      ? "reply"
      : "fyi";
  return {
    id: message.id,
    source: "email",
    sender: parseSenderDisplay(message.sender),
    title: message.subject?.trim() || "(No subject)",
    summary: message.take?.trim() || message.snippet?.trim() || "",
    tags: [tagForCategory(message.category)],
    section,
    category: message.category,
  };
}
