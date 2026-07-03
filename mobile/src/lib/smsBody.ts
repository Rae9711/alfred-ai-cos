/** Plain-text SMS body when ingest stored a stringified Shortcut JSON payload. */

const SMS_BODY_KEYS = ["text", "body", "shortcut_input", "message", "content"] as const;

function extractFromParsed(value: unknown): string | null {
  if (typeof value === "string") {
    const inner = value.trim();
    if (inner.startsWith("{")) {
      const nested = normalizeSmsBody(inner);
      return nested || null;
    }
    return inner || null;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of SMS_BODY_KEYS) {
      const field = (value as Record<string, unknown>)[key];
      const extracted = extractFromParsed(field);
      if (extracted) return extracted;
    }
  }
  return null;
}

export function normalizeSmsBody(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text.startsWith("{")) return text;
  try {
    const parsed = JSON.parse(text) as unknown;
    return extractFromParsed(parsed) ?? text;
  } catch {
    return text;
  }
}
