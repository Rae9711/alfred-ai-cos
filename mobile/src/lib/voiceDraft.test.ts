import { describe, expect, it } from "vitest";

import { appendVoiceTranscript } from "./voiceDraft";

describe("appendVoiceTranscript", () => {
  it("returns current when transcript is empty", () => {
    expect(appendVoiceTranscript("hello", "  ")).toBe("hello");
  });

  it("uses transcript alone when composer is empty", () => {
    expect(appendVoiceTranscript("", "book lunch")).toBe("book lunch");
    expect(appendVoiceTranscript("  ", "提醒我开会")).toBe("提醒我开会");
  });

  it("appends with a space when there is an existing draft", () => {
    expect(appendVoiceTranscript("Hey Alfred,", "remind me tomorrow")).toBe(
      "Hey Alfred, remind me tomorrow",
    );
    expect(appendVoiceTranscript("请帮我", "发邮件给 Daniel")).toBe(
      "请帮我 发邮件给 Daniel",
    );
  });
});
