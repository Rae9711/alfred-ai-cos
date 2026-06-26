/** Client-side parse for "text {name}: {body}" style requests in Ask free chat. */

export type SmsComposeIntent = {
  recipientName: string;
  bodyHint: string | null;
};

const PATTERNS: RegExp[] = [
  // 给 k姐宝贝 发：明天见 / 给 Mom 发 明天见 / 给Mom发：明天见
  /^给\s*(.+?)\s*发(?:短信|信息)?\s*[：:]\s*(.+)$/iu,
  /^给\s*(.+?)\s*发(?:短信|信息)?\s+(.+)$/iu,
  /^给\s*(.+?)\s*发(?:短信|信息)?\s*$/iu,
  /^发给\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^发给\s*(.+?)\s+(.+)$/iu,
  /^发给\s*(.+?)\s*$/iu,
  /^(?:发短信|发信息)给\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^(?:发短信|发信息)给\s*(.+?)\s+(.+)$/iu,
  /^(?:发短信|发信息)给\s*(.+?)\s*$/iu,
  // 短信 Mom：明天见 / 发信息给 Mom
  /^(?:短信|信息)\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^发\s*(.+?)\s*[：:]\s*(.+)$/iu,
  // text Mom: see you / send Mom a text saying hi
  /^(?:text|message|sms)\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^(?:text|message|sms)\s+(.+?)\s+(.+)$/iu,
  /^(?:text|message|sms)\s+(.+?)\s*$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s+(.+)$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s*$/iu,
  /^send\s+(.+?)\s*[：:]\s*(.+)$/iu,
];

function cleanName(raw: string): string {
  return raw.trim().replace(/^["'「『]|["'」』]$/g, "").trim();
}

function cleanBody(raw: string | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/** Backend may still return legacy calendar-only refusals until deployed. */
export function isCalendarOnlyRefusal(reply: string): boolean {
  return /only help with calendar|can only help with calendar|只能.*日历|仅.*日历/i.test(
    reply,
  );
}

export function parseSmsComposeIntent(text: string): SmsComposeIntent | null {
  const q = text.trim();
  if (!q) return null;

  for (const pattern of PATTERNS) {
    const m = q.match(pattern);
    if (!m) continue;
    const name = cleanName(m[1] ?? "");
    if (!name) return null;
    return { recipientName: name, bodyHint: cleanBody(m[2]) };
  }
  return null;
}
