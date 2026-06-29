// Android share-target helper: forward shared plain text to the SMS inbox webhook.

import { api } from "@/api/client";
import { buildSmsForwardPayload } from "@/lib/smsForwardPayload";
import { extractShareTextFromUrl } from "@/lib/smsShareUrl";

let handled = false;

export async function postSmsForward(
  text: string,
  opts?: { backfill?: boolean },
): Promise<void> {
  const cfg = await api.getSmsForwarding();
  const res = await fetch(cfg.webhook_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sms-Token": cfg.token,
    },
    body: JSON.stringify(buildSmsForwardPayload(text, { backfill: opts?.backfill })),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function handleSharedTextUrl(url: string | null): Promise<boolean> {
  if (!url || handled) return false;
  const text = extractShareTextFromUrl(url);
  if (!text) return false;

  handled = true;
  try {
    await postSmsForward(text, { backfill: true });
    return true;
  } finally {
    handled = false;
  }
}

export { extractShareTextFromUrl } from "@/lib/smsShareUrl";
