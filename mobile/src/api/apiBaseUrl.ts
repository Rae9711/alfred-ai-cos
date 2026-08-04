// Resolve the Albert API origin for native / web clients.
//
// Preview/production builds must never fall back to localhost — that produces
// React Native's opaque "Network request failed" on a real device. Keep this
// aligned with app.json `extra.apiBaseUrl` and the keyboard App Group default.

import Constants from "expo-constants";
import { Platform } from "react-native";

export const PRODUCTION_API_BASE_URL = "https://alfredaitech.com";

function fromExtra(extra: unknown): string | undefined {
  if (!extra || typeof extra !== "object") return undefined;
  const value = (extra as { apiBaseUrl?: unknown }).apiBaseUrl;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Prefer (in order):
 *   1. EXPO_PUBLIC_API_BASE_URL (build-time / Metro override)
 *   2. app config `extra.apiBaseUrl` (app.json / EAS Update expoClient)
 *   3. Production host — never localhost on a device build
 *
 * Web __DEV__ uses the local CORS proxy (scripts/dev-api-proxy.mjs).
 */
export function resolveApiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  if (Platform.OS === "web" && __DEV__) {
    return "http://localhost:8000";
  }

  const fromExpoConfig = fromExtra(Constants.expoConfig?.extra);
  if (fromExpoConfig) return fromExpoConfig.replace(/\/$/, "");

  // EAS Update manifests expose the same config under extra.expoClient.extra.
  const manifest2 = Constants.manifest2 as
    | { extra?: { expoClient?: { extra?: unknown } } }
    | null
    | undefined;
  const fromManifest = fromExtra(manifest2?.extra?.expoClient?.extra);
  if (fromManifest) return fromManifest.replace(/\/$/, "");

  // Native __DEV__ against a local backend: only when explicitly requested.
  if (__DEV__ && process.env.EXPO_PUBLIC_USE_LOCAL_API === "1") {
    return "http://localhost:8000";
  }

  return PRODUCTION_API_BASE_URL;
}
