/** Client-side parse for "text {name}: {body}" style requests in Ask free chat. */

export type SmsComposeIntent = {
  recipientName: string;
  bodyHint: string | null;
};

const VERB = "(?:发送|发|写)";
const QUANTIFIER = "(?:一条|一个|一份|条|个|份)?";
const SMS_NOUN = "(?:短信|信息|text|message|sms)";
const SEP =
  "(?:[，,：:]\\s*|\\s*(?:说|说下|说一下|告诉他|告诉她|告诉他们|内容是|内容为|大意是|大概是)|\\s+about)";

const PREFIX_RE =
  /^(?:帮我|帮忙|帮个忙|请你|请|麻烦|你能|能不能|能否|可以帮我|可以|拜托|hey|hi|please|could you|can you|would you)\s*/iu;

const PATTERNS: RegExp[] = [
  // 给 X 发：BODY（口语省略「短信」）
  /^给\s*(.+?)\s*发\s*[：:]\s*(.+)$/iu,
  // 给 X 发 Y 的 短信
  new RegExp(
    `^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}(.+?)的${SMS_NOUN}\\s*$`,
    "iu",
  ),
  // 给 X 发 短信 [SEP] BODY
  new RegExp(
    `^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}${SMS_NOUN}\\s*${SEP}\\s*(.+)$`,
    "iu",
  ),
  // 给 X 发 短信 BODY（无逗号/说/空格）
  new RegExp(
    `^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}${SMS_NOUN}\\s*(.+)$`,
    "iu",
  ),
  // 给 X 发 短信（no body）
  new RegExp(`^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}${SMS_NOUN}\\s*$`, "iu"),
  // 发给 X [SEP] BODY
  new RegExp(`^发给\\s*(.+?)\\s*${SEP}\\s*(.+)$`, "iu"),
  new RegExp(`^发给\\s*(.+?)\\s+(.+)$`, "iu"),
  new RegExp(`^发给\\s*(.+?)\\s*$`, "iu"),
  // 发短信给 X
  new RegExp(
    `^${VERB}${QUANTIFIER}${SMS_NOUN}给\\s*(.+?)\\s*${SEP}\\s*(.+)$`,
    "iu",
  ),
  new RegExp(`^${VERB}${QUANTIFIER}${SMS_NOUN}给\\s*(.+?)\\s+(.+)$`, "iu"),
  new RegExp(`^${VERB}${QUANTIFIER}${SMS_NOUN}给\\s*(.+?)\\s*$`, "iu"),
  // 短信 X：BODY
  new RegExp(`^(?:短信|信息)\\s*(.+?)\\s*[：:]\s*(.+)$`, "iu"),
  // English
  /^(?:text|message|sms)\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^(?:text|message|sms)\s+(.+?)\s+about\s+(.+)$/iu,
  /^(?:text|message|sms)\s+(.+?)\s+(.+)$/iu,
  /^(?:text|message|sms)\s+(.+?)\s*$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s+about\s+(.+)$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s+(.+)$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s*$/iu,
  /^send\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^write\s+(?:a\s+)?(?:text|message|sms)\s+to\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^write\s+(.+?)\s+(?:a\s+)?(?:text|message|sms)\s+about\s+(.+)$/iu,
];

const STARTER_PATTERNS: RegExp[] = [
  /^给谁(?:发|写)(?:一条|一个|个|一份|条|份)?(?:短信|信息)$/iu,
  /^(?:发|写|发送)(?:一条|一个|个|一份|条|份)?(?:短信|信息)$/iu,
  /^(?:发|写|发送)(?:一条|一个|个|一份|条|份)?(?:短信|信息)给谁$/iu,
  /^(?:text|message|sms)\s+someone$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)$/iu,
  /^send\s+(?:a\s+)?(?:text|message|sms)\s+to\s+someone$/iu,
  /^write\s+(?:a\s+)?(?:text|message|sms)$/iu,
];

function stripPrefix(text: string): string {
  let out = text;
  for (let i = 0; i < 2; i++) {
    const next = out.replace(PREFIX_RE, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

function cleanName(raw: string): string {
  return raw.trim().replace(/^["'「『]|["'」』]$/g, "").trim();
}

function cleanBody(raw: string | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().replace(/^[，,：:\s]+/, "");
  return t.length > 0 ? t : null;
}

/** Backend may still return legacy calendar-only refusals until deployed. */
export function isCalendarOnlyRefusal(reply: string): boolean {
  return /only help with calendar|can only help with calendar|只能.*日历|仅.*日历/i.test(
    reply,
  );
}

/** User wants to text but didn't name a recipient yet. */
export function parseSmsComposeStarter(text: string): boolean {
  const q = stripPrefix(text.trim());
  if (!q) return false;
  return STARTER_PATTERNS.some((p) => p.test(q));
}

/** Normalize free-text phone entry from chat or sheet. */
export function normalizePhoneInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/[^\d+]/g, "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return normalized.startsWith("+") ? `+${digits}` : digits;
}

export function parseSmsComposeIntent(text: string): SmsComposeIntent | null {
  const q = stripPrefix(text.trim());
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
