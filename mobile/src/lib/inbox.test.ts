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

  it("maps past-due subject Processing to needs reply", () => {
    const item = mapInboxMessage({
      id: "6",
      sender: "Chase <billing@chase.com>",
      subject: "Action needed, your balance is now past due",
      snippet: "Please pay now",
      take: null,
      category: "Processing",
      sent_at: null,
      mailbox_email: "",
      action_required: false,
      is_unread: true,
      user_replied: false,
    });
    expect(item.section).toBe("reply");
    expect(item.category).toBe("Needs Reply");
  });

  it("maps action-required Processing to needs reply", () => {
    const item = mapInboxMessage({
      id: "5",
      sender: "a@b.com",
      subject: "Hi",
      snippet: "snip",
      take: null,
      category: "Processing",
      sent_at: null,
      mailbox_email: "",
      action_required: true,
      is_unread: true,
      user_replied: false,
    });
    expect(item.section).toBe("reply");
    expect(item.category).toBe("Needs Reply");
    expect(item.tags.map((t) => t.label)).toEqual(["Needs Reply"]);
    expect(item.showReplyActions).toBe(true);
  });

  it("upgrades FYI when subject implies action", () => {
    const item = mapInboxMessage({
      id: "6b",
      sender: "billing@stripe.com",
      subject: "Action needed: payment failed",
      snippet: "Update your card",
      take: null,
      category: "FYI",
      sent_at: null,
      mailbox_email: "",
      action_required: false,
      is_unread: true,
      user_replied: false,
    });
    expect(item.section).toBe("reply");
    expect(item.category).toBe("Needs Reply");
  });

  it("tags SMS and preserves unknown sender label", () => {
    const item = mapInboxMessage({
      id: "sms-1",
      sender: "Unknown sender",
      subject: "SMS",
      snippet: "Hey are you free?",
      take: "They asked if you're free.",
      category: "Needs Reply",
      sent_at: null,
      mailbox_email: "",
      action_required: true,
      is_unread: true,
      user_replied: false,
      source: "sms",
    });
    expect(item.source).toBe("sms");
    expect(item.sender).toBe("Unknown sender");
    expect(item.tags.map((t) => t.label)).toEqual(["SMS", "Needs Reply"]);
    expect(item.title).toBe("Hey are you free?");
  });

  it("maps user-decided mail to fyi section", () => {
    const item = mapInboxMessage({
      id: "7",
      sender: "a@b.com",
      subject: "Hi",
      snippet: "snip",
      take: "Handled",
      category: "FYI",
      sent_at: null,
      mailbox_email: "",
      action_required: false,
      is_unread: false,
      user_replied: false,
      user_decided: true,
    });
    expect(item.section).toBe("fyi");
    expect(item.userDecided).toBe(true);
    expect(item.showReplyActions).toBe(false);
  });
});
