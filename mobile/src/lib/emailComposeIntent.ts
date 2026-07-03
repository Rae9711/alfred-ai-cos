/** Client-side parse for "email {name} about …" style requests in Ask free chat. */

export type EmailComposeIntent = {
  recipientName: string;
  bodyHint: string | null;
};

// Verbs and quantifiers a Chinese speaker might use when asking Alfred to email someone.
// Broad on purpose — the alternative is falling through to /assistant/chat which refuses.
const VERB = "(?:发送|发|写|来一封|来一个)";
const QUANTIFIER = "(?:一封|一个|一份|封|个|份)?";
const EMAIL_NOUN = "(?:邮件|电邮|信件|email)";
const SEP =
  "(?:[，,：:]\\s*|\\s*(?:说|说下|说一下|告诉他|告诉她|告诉他们|内容是|内容为|大意是|大概是)|\\s+about)";

// Optional polite / directive prefixes we strip before matching.
const PREFIX_RE =
  /^(?:帮我|帮忙|帮个忙|请你|请|麻烦|你能|能不能|能否|可以帮我|可以|拜托|hey|hi|please|could you|can you|would you)\s*/iu;

const PATTERNS: RegExp[] = [
  // 给 X 发/写 Y 的 邮件 —— body 明确以"的"结尾（避免把量词误当 body）
  new RegExp(
    `^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}(.+?)的${EMAIL_NOUN}(?:件)?\\s*$`,
    "iu",
  ),
  // 给 X 发/写 邮件 [，,：:说...] Y
  new RegExp(
    `^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}${EMAIL_NOUN}(?:件)?\\s*${SEP}\\s*(.+)$`,
    "iu",
  ),
  // 给 X 发/写 邮件 BODY（无逗号/说，直接跟内容）
  new RegExp(
    `^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}${EMAIL_NOUN}(?:件)?\\s*(.+)$`,
    "iu",
  ),
  // 给 X 发/写 邮件 (no body)
  new RegExp(
    `^给\\s*(.+?)\\s*${VERB}${QUANTIFIER}${EMAIL_NOUN}(?:件)?\\s*$`,
    "iu",
  ),
  // 发/写 (一封|个)? 邮件 给 X [SEP] Y
  new RegExp(
    `^${VERB}${QUANTIFIER}${EMAIL_NOUN}(?:件)?\\s*给\\s*(.+?)\\s*${SEP}\\s*(.+)$`,
    "iu",
  ),
  // 发/写 邮件 给 X (no body)
  new RegExp(
    `^${VERB}${QUANTIFIER}${EMAIL_NOUN}(?:件)?\\s*给\\s*(.+?)\\s*$`,
    "iu",
  ),
  // 邮件 X：Y / 邮件 X about Y
  /^(?:邮件|email)\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^(?:邮件|email)\s+(.+?)\s+about\s+(.+)$/iu,
  // English
  /^email\s+(.+?)\s+about\s+(.+)$/iu,
  /^email\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^email\s+(.+?)\s*$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+(.+?)\s+about\s+(.+)$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+(.+?)\s*$/iu,
  /^send\s+(.+?)\s+an\s+email\s+about\s+(.+)$/iu,
  /^write\s+(?:an?\s+)?email\s+to\s+(.+?)\s+about\s+(.+)$/iu,
  /^write\s+(?:an?\s+)?email\s+to\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^write\s+(?:an?\s+)?email\s+to\s+(.+?)\s*$/iu,
  /^write\s+(.+?)\s+an\s+email\s+about\s+(.+)$/iu,
];

const STARTER_PATTERNS: RegExp[] = [
  /^给谁(?:发|写)(?:一封|一个|个|一份|封|份)?(?:邮件|电邮|信件|email)$/iu,
  /^(?:发|写|发送)(?:一封|一个|个|一份|封|份)?(?:邮件|电邮|信件|email)$/iu,
  /^(?:发|写|发送)(?:一封|一个|个|一份|封|份)?(?:邮件|电邮|信件|email)给谁$/iu,
  /^email\s+someone$/iu,
  /^send\s+(?:an?\s+)?email$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+someone$/iu,
  /^write\s+(?:an?\s+)?email$/iu,
];

function stripPrefix(text: string): string {
  let out = text;
  // Strip up to two nested polite prefixes ("帮我请…").
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

/** User wants to email but didn't name a recipient yet. */
export function parseEmailComposeStarter(text: string): boolean {
  const q = stripPrefix(text.trim());
  if (!q) return false;
  return STARTER_PATTERNS.some((p) => p.test(q));
}

/** Normalize free-text email entry from chat or sheet. */
export function normalizeEmailInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const email = trimmed.replace(/^mailto:/i, "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email.toLowerCase();
}

export function parseEmailComposeIntent(text: string): EmailComposeIntent | null {
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
