// Local persistence for Ask free-chat messages (not email task threads).
// Uses secureStorage.ts — Keychain on native, localStorage on web dev.

import {
  deleteSecureItem,
  readSecureItem,
  writeSecureItem,
} from "@/lib/secureStorage";

export type PersistedFreeMsg = {
  role: "user" | "alfred";
  text: string;
  ts: string;
  smsDraft?: { name: string; phone: string; body: string };
};

const STORAGE_KEY = "albert.ask.freeChat.v1";
const MAX_MESSAGES = 100;

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

/** Load persisted free-chat messages, or null if none / corrupt. */
export async function loadFreeChatHistory(): Promise<PersistedFreeMsg[] | null> {
  try {
    const raw = await readSecureItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: PersistedFreeMsg[] };
    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      return null;
    }
    return parsed.messages.filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "alfred") &&
        typeof m.text === "string",
    );
  } catch {
    return null;
  }
}

/** Persist the current free-chat transcript (trimmed to MAX_MESSAGES). */
export async function saveFreeChatHistory(
  messages: PersistedFreeMsg[],
): Promise<void> {
  const trimmed = messages.slice(-MAX_MESSAGES);
  await writeSecureItem(STORAGE_KEY, JSON.stringify({ messages: trimmed }));
}

/** Wipe stored free-chat history (sign-out or Settings). */
export async function clearFreeChatHistory(): Promise<void> {
  await deleteSecureItem(STORAGE_KEY);
  notifyCleared();
}
