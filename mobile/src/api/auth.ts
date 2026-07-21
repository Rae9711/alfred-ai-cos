// Session token storage. The Albert session JWT lives in the device secure store
// on native (Keychain/Keystore). On web dev builds it falls back to localStorage
// via secureStorage.ts — expo-secure-store has no web implementation. The token
// arrives via the albert://auth?token=... deep link after Google OAuth completes
// on the backend. On iOS we also mirror the token into the App Group so the
// Alfred Keyboard extension can call the API.

import {
  deleteSecureItem,
  readSecureItem,
  writeSecureItem,
} from "@/lib/secureStorage";
import { syncAuthToAppGroup } from "@/lib/appGroupHandoff";

const TOKEN_KEY = "albert.session_token";

export async function getToken(): Promise<string | null> {
  return readSecureItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await writeSecureItem(TOKEN_KEY, token);
  await syncAuthToAppGroup(token);
}

export async function clearToken(): Promise<void> {
  await deleteSecureItem(TOKEN_KEY);
  await syncAuthToAppGroup(null);
}
