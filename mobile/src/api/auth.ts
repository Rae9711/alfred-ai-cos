// Session token storage. The Albert session JWT lives in the device secure store
// on native (Keychain/Keystore). On web dev builds it falls back to localStorage
// via secureStorage.ts — expo-secure-store has no web implementation. The token
// arrives via the albert://auth?token=... deep link after Google OAuth completes
// on the backend. On iOS we also mirror the token into the App Group so the
// Alfred Keyboard extension can call the API.

import {
  AFTER_FIRST_UNLOCK_OPTS,
  deleteSecureItem,
  readSecureItem,
  writeSecureItem,
} from "@/lib/secureStorage";
import { syncAuthToAppGroup } from "@/lib/appGroupHandoff";

const TOKEN_KEY = "albert.session_token";
const KEYCHAIN_OPTS = AFTER_FIRST_UNLOCK_OPTS;

/** In-memory cache so startup storms don't hit Keychain on every request. */
let cachedToken: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  const token = await readSecureItem(TOKEN_KEY, KEYCHAIN_OPTS);
  cachedToken = token;
  return token;
}

export async function setToken(token: string): Promise<void> {
  cachedToken = token;
  await writeSecureItem(TOKEN_KEY, token, KEYCHAIN_OPTS);
  await syncAuthToAppGroup(token);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  await deleteSecureItem(TOKEN_KEY);
  await syncAuthToAppGroup(null);
}
