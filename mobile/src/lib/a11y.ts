// Thin wrapper around AccessibilityInfo. react-native's source uses Flow
// syntax the lightweight vitest setup can't parse (see vitest.config.ts), so
// call sites that need unit tests should import this instead of react-native
// directly and mock it the same way secureStorage.ts is mocked.

import { AccessibilityInfo } from "react-native";

export function announceForAccessibility(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}
