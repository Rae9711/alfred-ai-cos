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
      mailbox_email: "",
      action_required: true,
      is_unread: true,
      user_replied: false,
    });
    expect(item.section).toBe("reply");
    expect(item.showReplyActions).toBe(true);
    expect(item.summary).toBe("You owe a reply");
  });

  it("moves replied mail out of reply section", () => {
    const item = mapInboxMessage({
      id: "3",
      sender: "a@b.com",
      subject: "Hi",
      snippet: "snip",
      take: "You replied",
      category: "Needs Reply",
      sent_at: null,
      mailbox_email: "",
      action_required: true,
      is_unread: false,
      user_replied: true,
    });
    expect(item.section).toBe("fyi");
    expect(item.userReplied).toBe(true);
    expect(item.showReplyActions).toBe(false);
  });

  it("keeps read needs-reply in reply section", () => {
    const item = mapInboxMessage({
      id: "4",
      sender: "a@b.com",
      subject: "Hi",
      snippet: "snip",
      take: "Please reply",
      category: "Needs Reply",
      sent_at: null,
      mailbox_email: "",
      action_required: true,
      is_unread: false,
      user_replied: false,
    });
    expect(item.section).toBe("reply");
    expect(item.showReplyActions).toBe(true);
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
      mailbox_email: "",
      action_required: false,
      is_unread: false,
      user_replied: false,
    });
    expect(item.section).toBe("fyi");
    expect(item.summary).toBe("snip");
  });
});
