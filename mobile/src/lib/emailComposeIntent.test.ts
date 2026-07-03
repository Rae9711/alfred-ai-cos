import { describe, expect, it } from "vitest";

import {
  normalizeEmailInput,
  parseEmailComposeIntent,
  parseEmailComposeStarter,
} from "./emailComposeIntent";

describe("parseEmailComposeIntent", () => {
  it("parses Chinese 给 name 发邮件 body", () => {
    expect(parseEmailComposeIntent("给 Leo 发邮件：明天一起吃饭")).toEqual({
      recipientName: "Leo",
      bodyHint: "明天一起吃饭",
    });
    expect(parseEmailComposeIntent("给leo发一封明天一起吃饭的邮件")).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
  });

  it("parses without body hint", () => {
    expect(parseEmailComposeIntent("发邮件给 Leo")).toEqual({
      recipientName: "Leo",
      bodyHint: null,
    });
  });

  it("parses English email name about body", () => {
    expect(parseEmailComposeIntent("email Leo about dinner tomorrow")).toEqual({
      recipientName: "Leo",
      bodyHint: "dinner tomorrow",
    });
  });

  it("returns null for unrelated chat", () => {
    expect(parseEmailComposeIntent("text Mom: hi")).toBeNull();
  });

  it("detects email starter without recipient", () => {
    expect(parseEmailComposeStarter("发邮件")).toBe(true);
    expect(parseEmailComposeStarter("send an email")).toBe(true);
    expect(parseEmailComposeStarter("email Leo about dinner")).toBe(false);
  });

  it("normalizes email addresses", () => {
    expect(normalizeEmailInput("leo@example.com")).toBe("leo@example.com");
    expect(normalizeEmailInput("mailto:Leo@Example.COM")).toBe("leo@example.com");
    expect(normalizeEmailInput("not-an-email")).toBeNull();
  });
});
