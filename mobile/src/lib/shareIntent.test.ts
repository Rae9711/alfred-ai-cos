import { describe, expect, it } from "vitest";

import { buildSmsForwardPayload } from "./smsForwardPayload";
import { extractShareTextFromUrl } from "./smsShareUrl";

describe("buildSmsForwardPayload", () => {
  it("maps body, text, and shortcut_input to the same trimmed text", () => {
    expect(buildSmsForwardPayload("  hello  ")).toEqual({
      body: "hello",
      text: "hello",
      shortcut_input: "hello",
    });
  });

  it("supports backfill flag", () => {
    expect(buildSmsForwardPayload("hi", { backfill: true })).toEqual({
      body: "hi",
      text: "hi",
      shortcut_input: "hi",
      backfill: true,
    });
  });
});

describe("extractShareTextFromUrl", () => {
  it("reads text from albert://share", () => {
    expect(
      extractShareTextFromUrl("albert://share?text=Hello%20world"),
    ).toBe("Hello world");
  });

  it("reads body query param", () => {
    expect(extractShareTextFromUrl("albert://share?body=Test")).toBe("Test");
  });

  it("returns null for unrelated URLs", () => {
    expect(extractShareTextFromUrl("albert://auth?token=abc")).toBeNull();
  });
});
