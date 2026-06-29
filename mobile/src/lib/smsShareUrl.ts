/** Parse albert://share deep links without native dependencies (testable in vitest). */

export function extractShareTextFromUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/^\//, "");
  const host = parsed.hostname;
  const isShare =
    path === "share" ||
    path.endsWith("/share") ||
    host === "share" ||
    host.endsWith(".share");
  if (!isShare) return null;
  const text = parsed.searchParams.get("text") ?? parsed.searchParams.get("body") ?? "";
  return text.trim() || null;
}
