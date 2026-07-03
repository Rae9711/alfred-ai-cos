import type { InboxMessage } from "@albert/shared-types";

import { loadContactNamesByPhone } from "@/lib/contacts";
import type { AppInboxItem } from "@/lib/inbox";
import { normalizeSmsBody } from "@/lib/smsBody";

const UNKNOWN_SENDERS = new Set(["Unknown sender", "未知发件人"]);

export function isUnknownSmsSender(label: string): boolean {
  return UNKNOWN_SENDERS.has(label.trim());
}

export function resolveSmsSenderDisplay(
  sender: string,
  replyPhone: string | null,
  phoneNames: Map<string, string>,
): string {
  const label = sender.trim();
  if (!replyPhone) return label;
  const digits = replyPhone.replace(/\D/g, "");
  const suffix = digits.slice(-10);
  if (!suffix) return label;
  const name = phoneNames.get(suffix);
  if (!name) return label;
  if (isUnknownSmsSender(label) || /^\+?\d[\d\s().-]*$/.test(label)) {
    return name;
  }
  return label;
}

/** Prefer inbox-enriched sender over API "Unknown sender". */
export function mergeSmsSenderDisplay(
  enrichedSender: string | undefined,
  apiSender: string,
): string {
  const api = apiSender.trim();
  if (enrichedSender && isUnknownSmsSender(api)) {
    return enrichedSender;
  }
  return api;
}

function normalizeSmsItem(item: AppInboxItem): AppInboxItem {
  if (item.source !== "sms") return item;
  return {
    ...item,
    title: normalizeSmsBody(item.title),
    summary: normalizeSmsBody(item.summary),
    take: item.take ? normalizeSmsBody(item.take) : item.take,
  };
}

export type SmsDetailFields = {
  sender: string;
  subject: string;
  summary: string | null;
  body: string;
  replyPhone: string | null;
};

/** Normalize SMS body fields and resolve sender from device contacts. */
export async function enrichSmsDetailFields(
  detail: {
    sender: string;
    subject?: string | null;
    snippet?: string | null;
    take?: string | null;
    body?: string | null;
    reply_phone?: string | null;
    source?: string | null;
  },
  opts?: { preferSender?: string },
): Promise<SmsDetailFields> {
  const isSms = detail.source === "sms";
  const replyPhone = detail.reply_phone?.trim() || null;
  const body = normalizeSmsBody(
    detail.body?.trim() || detail.snippet?.trim() || "",
  );
  const summary = detail.take?.trim()
    ? normalizeSmsBody(detail.take.trim())
    : null;
  const subject =
    detail.subject?.trim() ||
    (isSms ? normalizeSmsBody(detail.snippet?.trim() || "") : "") ||
    "Text message";

  let sender = detail.sender.trim();
  if (isSms) {
    sender = mergeSmsSenderDisplay(opts?.preferSender, sender);
    if (replyPhone && isUnknownSmsSender(sender)) {
      try {
        const phoneNames = await loadContactNamesByPhone();
        sender = resolveSmsSenderDisplay(sender, replyPhone, phoneNames);
      } catch {
        // Contacts unavailable — keep API label.
      }
    }
  }

  return { sender, subject, summary, body, replyPhone };
}

/** Resolve contact names for SMS rows and unwrap JSON bodies for display. */
export async function enrichInboxMessages(
  items: AppInboxItem[],
  rawMessages: InboxMessage[],
): Promise<AppInboxItem[]> {
  const normalized = items.map(normalizeSmsItem);
  const needsLookup = normalized.some(
    (item, index) =>
      item.source === "sms" &&
      (isUnknownSmsSender(item.sender) ||
        Boolean(rawMessages[index]?.reply_phone?.trim())),
  );
  if (!needsLookup) return normalized;

  let phoneNames = new Map<string, string>();
  try {
    phoneNames = await loadContactNamesByPhone();
  } catch {
    return normalized;
  }

  return normalized.map((item, index) => {
    if (item.source !== "sms") return item;
    const phone = rawMessages[index]?.reply_phone?.trim() || item.replyPhone;
    return {
      ...item,
      sender: resolveSmsSenderDisplay(item.sender, phone ?? null, phoneNames),
    };
  });
}
