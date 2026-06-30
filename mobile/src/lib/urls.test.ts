import { describe, expect, it } from "vitest";

import { extractUrls, urlLabel } from "./urls";

describe("extractUrls", () => {
  it("finds links in snippet and dedupes", () => {
    const urls = extractUrls(
      "See https://example.com/a and https://example.com/a again",
      "Also https://docs.google.com/form",
    );
    expect(urls).toEqual([
      "https://example.com/a",
      "https://docs.google.com/form",
    ]);
  });

  it("strips trailing punctuation", () => {
    expect(extractUrls("Visit https://pay.stripe.com/invoice/1.")).toEqual([
      "https://pay.stripe.com/invoice/1",
    ]);
  });
});

describe("urlLabel", () => {
  it("shortens host and path", () => {
    expect(urlLabel("https://www.notion.so/page")).toBe("notion.so/page");
  });
});
