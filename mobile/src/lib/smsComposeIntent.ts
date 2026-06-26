/** Client-side parse for "text {name}: {body}" style requests in Ask free chat. */

export type SmsComposeIntent = {
  recipientName: string;
  bodyHint: string | null;
};

const PATTERNS: RegExp[] = [
  // 给 k姐宝贝 发：明天见 / 给 Mom 发 明天见
  /^给\s*(.+?)\s*发(?:短信|信息)?\s*[：:]\s*(.+)$/iu,
  /^给\s*(.+?)\s*发(?:短信|信息)?\s+(.+)$/iu,
  /^给\s*(.+?)\s*发(?:短信|信息)?\s*$/iu,
  /^发给\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^发给\s*(.+?)\s+(.+)$/iu,
  /^发给\s*(.+?)\s*$/iu,
  /^(?:发短信|发信息)给\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^(?:发短信|发信息)给\s*(.+?)\s+(.+)$/iu,
  /^(?:发短信|发信息)给\s*(.+?)\s*$/iu,
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
