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

function normalizeSmsItem(item: AppInboxItem): AppInboxItem {
  if (item.source !== "sms") return item;
  return {
    ...item,
    title: normalizeSmsBody(item.title),
    summary: normalizeSmsBody(item.summary),
    take: item.take ? normalizeSmsBody(item.take) : item.take,
  };
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
