// Android share-target helper: forward shared plain text to the SMS inbox webhook.

import * as Linking from "expo-linking";

import { api } from "@/api/client";

let handled = false;

export async function handleSharedTextUrl(url: string | null): Promise<boolean> {
  if (!url || handled) return false;
  const parsed = Linking.parse(url);
  const path = parsed.path ?? "";
  if (path !== "share" && !path.endsWith("/share")) return false;

  const text =
    (typeof parsed.queryParams?.text === "string" && parsed.queryParams.text) ||
    (typeof parsed.queryParams?.body === "string" && parsed.queryParams.body) ||
    "";
  if (!text.trim()) return false;

  handled = true;
  try {
    const cfg = await api.getSmsForwarding();
    const res = await fetch(`${cfg.webhook_url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sms-Token": cfg.token,
      },
      body: JSON.stringify({ body: text.trim(), backfill: true }),
    });
    if (!res.ok) throw new Error(await res.text());
    return true;
  } finally {
    handled = false;
  }
}

export function extractShareTextFromUrl(url: string): string | null {
  const parsed = Linking.parse(url);
  const path = parsed.path ?? "";
  if (path !== "share" && !path.endsWith("/share")) return null;
  const text =
    (typeof parsed.queryParams?.text === "string" && parsed.queryParams.text) ||
    (typeof parsed.queryParams?.body === "string" && parsed.queryParams.body) ||
    "";
  return text.trim() || null;
}
