/** Score how well a contact name matches a user-typed query (0–100). */

export type NameScored<T> = T & { score: number };

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function contactNameCandidates(contact: {
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  nickname?: string | null;
}): string[] {
  const parts = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  return [
    contact.name,
    contact.firstName,
    contact.lastName,
    contact.nickname,
    parts || null,
  ].filter((s): s is string => Boolean(s?.trim()));
}

/** Prefer exact / prefix matches; avoid loose substring false positives. */
export function scoreContactNameMatch(
  query: string,
  contact: {
    name?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    nickname?: string | null;
  },
): number {
  const q = normalize(query);
  if (!q) return 0;

  let best = 0;
  for (const raw of contactNameCandidates(contact)) {
    const c = normalize(raw);
    if (!c) continue;
    if (c === q) {
      best = Math.max(best, 100);
      continue;
    }
    if (c.startsWith(q) || q.startsWith(c)) {
      best = Math.max(best, 88);
      continue;
    }
    const words = c.split(" ");
    if (words.some((w) => w === q || (q.length >= 2 && w.startsWith(q)))) {
      best = Math.max(best, 85);
    }
  }
  return best;
}

/** Auto-pick only when there is a single strong match. */
export function pickAutoContact<T extends { score: number }>(
  matches: T[],
): T | null {
  const strong = matches.filter((m) => m.score >= 95);
  if (strong.length === 1) return strong[0]!;
  return null;
}
