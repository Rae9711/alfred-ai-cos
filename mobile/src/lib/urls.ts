const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

/** Pull http(s) links from free text (snippet, body, take). */
export function extractUrls(...parts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    for (const match of part.matchAll(URL_RE)) {
      const raw = match[0]!.replace(/[.,;:!?)]+$/, "");
      if (!seen.has(raw)) {
        seen.add(raw);
        urls.push(raw);
      }
    }
  }
  return urls;
}

/** Short label for a URL button (domain + path hint). */
export function urlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const label = `${host}${path}`;
    return label.length > 48 ? `${label.slice(0, 45)}…` : label;
  } catch {
    return url.length > 48 ? `${url.slice(0, 45)}…` : url;
  }
}
