import { describe, expect, it } from "vitest";

import {
  normalizePhoneInput,
  parseSmsComposeIntent,
  parseSmsComposeStarter,
  isCalendarOnlyRefusal,
} from "./smsComposeIntent";

describe("parseSmsComposeIntent", () => {
  it("parses Chinese 给 name 发：body", () => {
    expect(parseSmsComposeIntent("给 k姐宝贝 发：明天见")).toEqual({
      recipientName: "k姐宝贝",
      bodyHint: "明天见",
    });
    expect(parseSmsComposeIntent("给 Mom 发：明天见")).toEqual({
      recipientName: "Mom",
      bodyHint: "明天见",
    });
  });

  it("parses 给 name 发短信 body without colon", () => {
    expect(parseSmsComposeIntent("给leo发短信明天一起吃饭")).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
    expect(parseSmsComposeIntent("给 Leo 发短信 明天见")).toEqual({
      recipientName: "Leo",
      bodyHint: "明天见",
    });
  });

  it("parses with polite prefixes and comma", () => {
    expect(parseSmsComposeIntent("帮我给Leo发一条明天见面的短信")).toEqual({
      recipientName: "Leo",
      bodyHint: "明天见面",
    });
    expect(parseSmsComposeIntent("给leo发短信，明天一起吃饭")).toEqual({
      recipientName: "leo",
      bodyHint: "明天一起吃饭",
    });
    expect(parseSmsComposeIntent("请给leo发短信说明天见")).toEqual({
      recipientName: "leo",
      bodyHint: "明天见",
    });
  });

  it("parses 短信 name：body", () => {
    expect(parseSmsComposeIntent("短信 Mom：明天见")).toEqual({
      recipientName: "Mom",
      bodyHint: "明天见",
    });
  });

  it("parses without body", () => {
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
    expect(parseSmsComposeIntent("给leo发邮件明天见")).toBeNull();
  });

  it("detects SMS starter without recipient", () => {
    expect(parseSmsComposeStarter("给谁发短信")).toBe(true);
    expect(parseSmsComposeStarter("帮我发短信")).toBe(true);
    expect(parseSmsComposeStarter("text someone")).toBe(true);
    expect(parseSmsComposeStarter("text Mom: hi")).toBe(false);
  });

  it("normalizes phone numbers", () => {
    expect(normalizePhoneInput("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhoneInput("13800000000")).toBe("13800000000");
    expect(normalizePhoneInput("123")).toBeNull();
  });

  it("detects calendar-only refusal", () => {
    expect(isCalendarOnlyRefusal("I can only help with calendar")).toBe(true);
  });
});
