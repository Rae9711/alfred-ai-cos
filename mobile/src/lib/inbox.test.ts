import { describe, expect, it } from "vitest";

import { mapInboxMessage, parseSenderDisplay } from "./inbox";

describe("parseSenderDisplay", () => {
  it("extracts name from angle-bracket form", () => {
    expect(parseSenderDisplay('Ray Wang <ruiray@gmail.com>')).toBe("Ray Wang");
  });
});

describe("mapInboxMessage", () => {
  it("maps needs reply to reply section", () => {
    const item = mapInboxMessage({
      id: "1",
      sender: "a@b.com",
      subject: "Hi",
      snippet: "snip",
      take: "You owe a reply",
      category: "Needs Reply",
      sent_at: null,
      action_required: true,
    });
    expect(item.section).toBe("reply");
    expect(item.summary).toBe("You owe a reply");
  });

  it("maps FYI to fyi section", () => {
    const item = mapInboxMessage({
      id: "2",
      sender: "a@b.com",
      subject: "FYI",
      snippet: "snip",
      take: null,
      category: "FYI",
      sent_at: null,
      action_required: false,
    });
    expect(item.section).toBe("fyi");
    expect(item.summary).toBe("snip");
  });
});
