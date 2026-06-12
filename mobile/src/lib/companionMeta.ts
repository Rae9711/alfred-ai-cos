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

// REVISION (race-condition bug fix): the original PR did load → applyEvent → save
// with no coordination. If two XP events fired while one was still awaiting
// storage (e.g. Ask sending several messages in flight), both loads read the
// same stale meta, both applied their gain to it, and the second save silently
// overwrote the first — XP was permanently lost (5 concurrent events landed as
// xp=5 instead of xp=25).
//
// Fix: every read-modify-write cycle is appended to one shared promise chain
// (`metaWriteQueue`), so mutations run strictly one-after-another no matter how
// many callers fire concurrently. Each caller still gets back its own result
// promise (`run`). The tail of the chain swallows rejections (.catch) so one
// failed mutation can't wedge the queue and block every later write.
// Regression-tested in companionMeta.test.ts ("does not lose XP when events
// fire concurrently").
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
