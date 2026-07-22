// Intentionally does NOT import or require `@sentry/react-native`.
// Loading that package on cold start crashed older IPAs (and any OTA that
// pulled it in). Re-enable only after a native build that ships RNSentry
// and a non-empty sentryDsn.

export function initSentryIfAvailable(_opts: {
  dsn: string;
  environment: string;
}): void {
  // no-op
}

export function wrapWithSentry<T>(component: T): T {
  return component;
}

export function captureException(_error: unknown): void {
  // no-op
}
