// Cache onboarded flag so cold start can route past the spinner without waiting
// on GET /me. The server remains the source of truth; this is a soft gate only.

import {
  AFTER_FIRST_UNLOCK_OPTS,
  deleteSecureItem,
  readSecureItem,
  writeSecureItem,
} from "@/lib/secureStorage";

const KEY = "albert.onboarded";

export async function readOnboardedCache(): Promise<boolean | null> {
  const raw = await readSecureItem(KEY, AFTER_FIRST_UNLOCK_OPTS);
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export async function writeOnboardedCache(onboarded: boolean): Promise<void> {
  await writeSecureItem(KEY, onboarded ? "1" : "0", AFTER_FIRST_UNLOCK_OPTS);
}

export async function clearOnboardedCache(): Promise<void> {
  await deleteSecureItem(KEY);
}
