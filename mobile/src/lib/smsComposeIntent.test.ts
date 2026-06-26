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
    expect(parseSmsComposeIntent("给Mom发：明天见")).toEqual({
      recipientName: "Mom",
      bodyHint: "明天见",
    });
  });

  it("parses 短信 name：body", () => {
    expect(parseSmsComposeIntent("短信 Mom：明天见")).toEqual({
      recipientName: "Mom",
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

  it("detects SMS starter without recipient", () => {
    expect(parseSmsComposeStarter("给谁发短信")).toBe(true);
    expect(parseSmsComposeStarter("text someone")).toBe(true);
    expect(parseSmsComposeStarter("text Mom: hi")).toBe(false);
  });

  it("normalizes phone numbers", () => {
    expect(normalizePhoneInput("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhoneInput("13800000000")).toBe("13800000000");
    expect(normalizePhoneInput("123")).toBeNull();
  });
});
