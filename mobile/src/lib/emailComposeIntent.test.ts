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
    expect(parseEmailComposeIntent("给leo发一个明天一起吃饭的邮件")).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
  });

  it("parses with polite prefixes", () => {
    expect(
      parseEmailComposeIntent("帮我给Leo发一封关于明天晚饭的邮件"),
    ).toEqual({
      recipientName: "Leo",
      bodyHint: "关于明天晚饭",
    });
    expect(parseEmailComposeIntent("请给leo发邮件说明天一起吃饭")).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
    expect(
      parseEmailComposeIntent("麻烦给 leo 写封邮件，明天一起吃饭"),
    ).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
  });

  it("parses 写 as the verb", () => {
    expect(parseEmailComposeIntent("给leo写一封明天一起吃饭的邮件")).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
    expect(parseEmailComposeIntent("给 Leo 写封邮件")).toEqual({
      recipientName: "Leo",
      bodyHint: null,
    });
  });

  it("parses comma / 说 separators", () => {
    expect(parseEmailComposeIntent("给leo发邮件，明天一起吃饭")).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
    expect(parseEmailComposeIntent("给Leo发邮件说明天开会")).toEqual({
      recipientName: "Leo",
      bodyHint: "明天开会",
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
    expect(parseEmailComposeIntent("write leo an email about the project")).toEqual({
      recipientName: "leo",
      bodyHint: "the project",
    });
  });

  it("returns null for unrelated chat", () => {
    expect(parseEmailComposeIntent("text Mom: hi")).toBeNull();
    expect(parseEmailComposeIntent("给leo发条微信")).toBeNull();
    expect(parseEmailComposeIntent("what is on my calendar?")).toBeNull();
  });

  it("detects email starter without recipient", () => {
    expect(parseEmailComposeStarter("发邮件")).toBe(true);
    expect(parseEmailComposeStarter("写邮件")).toBe(true);
    expect(parseEmailComposeStarter("帮我发邮件")).toBe(true);
    expect(parseEmailComposeStarter("send an email")).toBe(true);
    expect(parseEmailComposeStarter("email Leo about dinner")).toBe(false);
  });

  it("normalizes email addresses", () => {
    expect(normalizeEmailInput("leo@example.com")).toBe("leo@example.com");
    expect(normalizeEmailInput("mailto:Leo@Example.COM")).toBe("leo@example.com");
    expect(normalizeEmailInput("not-an-email")).toBeNull();
  });
});
