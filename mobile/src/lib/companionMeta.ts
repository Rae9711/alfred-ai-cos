// Secure persistence for Alfred's companion agent metadata.
//
// Uses secureStorage.ts (Keychain on native, localStorage on web dev).

import {
  readSecureItem,
  writeSecureItem,
} from "@/lib/secureStorage";

import {
  applyEvent,
  getDefaultMeta,
  type AgentEventType,
  type AgentMeta,
  type AvatarState,
} from "./agentMeta";

const META_KEY = "albert.companion.meta";

/** Read persisted meta, merging with defaults and stripping invalid cosmetic ids. */
export async function loadCompanionMeta(): Promise<AgentMeta> {
  try {
    const raw = await readSecureItem(META_KEY);
    if (!raw) return getDefaultMeta();
    const merged = { ...getDefaultMeta(), ...JSON.parse(raw) } as AgentMeta;
    return merged;
  } catch {
    return getDefaultMeta();
  }
}

/** Persist meta after XP events or cosmetic changes. */
export async function saveCompanionMeta(meta: AgentMeta): Promise<void> {
  await writeSecureItem(META_KEY, JSON.stringify(meta));
}

// All read-modify-write cycles run through one promise chain so concurrent
// callers (e.g. Ask firing several in-flight messages) can't interleave their
// load → mutate → save steps and drop each other's writes. A rejected mutation
// must not poison the chain, hence the .catch on the tail.
let metaWriteQueue: Promise<unknown> = Promise.resolve();

function enqueueMetaMutation<T>(mutate: () => Promise<T>): Promise<T> {
  const run = metaWriteQueue.then(mutate);
  metaWriteQueue = run.catch(() => undefined);
  return run;
}

/** Apply an XP event atomically: load → applyEvent → save, serialized. */
export async function recordCompanionEvent(
  eventType: AgentEventType,
): Promise<{ meta: AgentMeta; gainedXp: number; leveledUp: boolean }> {
  return enqueueMetaMutation(async () => {
    const current = await loadCompanionMeta();
    const { next, gainedXp, leveledUp } = applyEvent(current, eventType);
    await saveCompanionMeta(next);
    return { meta: next, gainedXp, leveledUp };
  });
}

/** Persist a tint-color change atomically; returns the updated meta. */
export async function updateCompanionColor(color: string): Promise<AgentMeta> {
  return enqueueMetaMutation(async () => {
    const current = await loadCompanionMeta();
    const next = { ...current, color };
    await saveCompanionMeta(next);
    return next;
  });
}

/** Map tab context to the avatar's visual mood. */
export function moodForContext(opts: {
  placement: "home" | "today" | "ask";
  thinking: boolean;
  sleeping: boolean;
}): AvatarState {
  if (opts.sleeping) return "sleep";
  if (opts.thinking) return "thinking";
  // Default idle everywhere — "focused" will map to Lottie segments when tasks run.
  return "idle";
}
