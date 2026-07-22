// Local persistence for Alfred free-chat messages (not email/SMS task threads).
// Uses secureStorage.ts — Keychain on native, localStorage on web dev.

import {
  AFTER_FIRST_UNLOCK_OPTS,
  deleteSecureItem,
  readSecureItem,
  writeSecureItem,
} from "@/lib/secureStorage";

export type PersistedFreeMsg = {
  role: "user" | "alfred";
  text: string;
  ts: string;
  smsDraft?: { name: string; phone: string; body: string };
  emailDraft?: {
    composeId: string;
    name: string;
    email: string;
    subject: string;
    body: string;
    sending?: boolean;
  };
};

const STORAGE_KEY = "albert.ask.freeChat.v1";
const MAX_MESSAGES = 100;
const KEYCHAIN_OPTS = AFTER_FIRST_UNLOCK_OPTS;

type Listener = () => void;
const clearListeners = new Set<Listener>();

/** Subscribe to clears (e.g. from Settings). Returns an unsubscribe fn. */
export function subscribeFreeChatCleared(listener: Listener): () => void {
  clearListeners.add(listener);
  return () => clearListeners.delete(listener);
}

function notifyCleared(): void {
  for (const fn of clearListeners) fn();
}

function parseStored(raw: string): PersistedFreeMsg[] | null {
  const parsed = JSON.parse(raw) as { messages?: PersistedFreeMsg[] };
  if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
    return null;
  }
  const messages = parsed.messages.filter(
    (m) =>
      m &&
      (m.role === "user" || m.role === "alfred") &&
      typeof m.text === "string",
  );
  return messages.length > 0 ? messages : null;
}

/** True when the transcript should be written (never persist seed-only greeting). */
export function hasPersistableFreeChatHistory(
  messages: PersistedFreeMsg[],
): boolean {
  return messages.some((m) => m.role === "user");
}

/** Load persisted free-chat messages, or null if none / corrupt. */
export async function loadFreeChatHistory(): Promise<PersistedFreeMsg[] | null> {
  try {
    const raw = await readSecureItem(STORAGE_KEY, KEYCHAIN_OPTS);
    if (!raw) return null;
    return parseStored(raw);
  } catch {
    return null;
  }
}

/** Retry load on cold start — Keychain can briefly return empty right after launch. */
export async function loadFreeChatHistoryWithRetry(
  attempts = 3,
): Promise<PersistedFreeMsg[] | null> {
  for (let i = 0; i < attempts; i++) {
    const loaded = await loadFreeChatHistory();
    if (loaded) return loaded;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 80 * (i + 1)));
    }
  }
  return null;
}

/** Persist the current free-chat transcript (trimmed to MAX_MESSAGES). */
export async function saveFreeChatHistory(
  messages: PersistedFreeMsg[],
): Promise<void> {
  if (!hasPersistableFreeChatHistory(messages)) return;
  const trimmed = messages.slice(-MAX_MESSAGES);
  await writeSecureItem(
    STORAGE_KEY,
    JSON.stringify({ messages: trimmed }),
    KEYCHAIN_OPTS,
  );
}

/** Wipe stored free-chat history (sign-out or Settings). */
export async function clearFreeChatHistory(): Promise<void> {
  await deleteSecureItem(STORAGE_KEY);
  notifyCleared();
}
