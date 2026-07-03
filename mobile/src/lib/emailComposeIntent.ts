/** Client-side parse for "email {name} about …" style requests in Ask free chat. */

export type EmailComposeIntent = {
  recipientName: string;
  bodyHint: string | null;
};

const PATTERNS: RegExp[] = [
  // 给 leo 发一封明天一起吃饭的邮件
  /^给\s*(.+?)\s*发(?:一封|个)?(.+?)(?:的)?(?:邮件|信)(?:件)?\s*$/iu,
  // 给 leo 发邮件：明天见
  /^给\s*(.+?)\s*发(?:一封|个)?(?:邮件|信)(?:件)?\s*[：:]\s*(.+)$/iu,
  /^给\s*(.+?)\s*发(?:一封|个)?(?:邮件|信)(?:件)?\s+(.+)$/iu,
  /^给\s*(.+?)\s*发(?:一封|个)?(?:邮件|信)(?:件)?\s*$/iu,
  /^发(?:一封|个)?(?:邮件|信)(?:件)?给\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^发(?:一封|个)?(?:邮件|信)(?:件)?给\s*(.+?)\s+(.+)$/iu,
  /^发(?:一封|个)?(?:邮件|信)(?:件)?给\s*(.+?)\s*$/iu,
  /^(?:邮件|email)\s*(.+?)\s*[：:]\s*(.+)$/iu,
  /^(?:邮件|email)\s+(.+?)\s+about\s+(.+)$/iu,
  /^(?:邮件|email)\s+(.+?)\s+(.+)$/iu,
  /^email\s+(.+?)\s+about\s+(.+)$/iu,
  /^email\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^email\s+(.+?)\s*$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+(.+?)\s+about\s+(.+)$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+(.+?)\s*[：:]\s*(.+)$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+(.+?)\s*$/iu,
  /^send\s+(.+?)\s+an\s+email\s+about\s+(.+)$/iu,
];

const STARTER_PATTERNS: RegExp[] = [
  /^给谁发邮件$/iu,
  /^发邮件$/iu,
  /^发一封邮件$/iu,
  /^email\s+someone$/iu,
  /^send\s+(?:an?\s+)?email$/iu,
  /^send\s+(?:an?\s+)?email\s+to\s+someone$/iu,
];

function cleanName(raw: string): string {
  return raw.trim().replace(/^["'「『]|["'」』]$/g, "").trim();
}

function cleanBody(raw: string | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/** User wants to email but didn't name a recipient yet. */
export function parseEmailComposeStarter(text: string): boolean {
  const q = text.trim();
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
