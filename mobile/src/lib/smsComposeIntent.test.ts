import { describe, expect, it } from "vitest";

import { parseSmsComposeIntent } from "./smsComposeIntent";

describe("parseSmsComposeIntent", () => {
  it("parses Chinese 给 name 发：body", () => {
    expect(parseSmsComposeIntent("给 k姐宝贝 发：明天见")).toEqual({
      recipientName: "k姐宝贝",
      bodyHint: "明天见",
    });
  });

  it("parses Chinese 发给 without body", () => {
    expect(parseSmsComposeIntent("发给 Mom")).toEqual({
      recipientName: "Mom",
      bodyHint: null,
    });
  });

  it("parses English text name: body", () => {
    expect(parseSmsComposeIntent("text Sarah: see you tomorrow")).toEqual({
      recipientName: "Sarah",
      bodyHint: "see you tomorrow",
    });
  });

  it("returns null for unrelated chat", () => {
    expect(parseSmsComposeIntent("What am I forgetting?")).toBeNull();
  });
});
