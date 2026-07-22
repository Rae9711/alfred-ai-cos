import { describe, expect, it } from "vitest";

import {
  mapInboxMessage,
  parseSenderDisplay,
  scopeToTab,
  statusPillFor,
  tabToScope,
} from "./inbox";

const statusLabels = {
  needsAction: "需处理",
  done: "已处理",
  fyi: "知晓即可",
  unread: "未读",
};

describe("parseSenderDisplay", () => {
  it("extracts name from angle-bracket form", () => {
    expect(parseSenderDisplay('Ray Wang <ruiray@gmail.com>')).toBe("Ray Wang");
  });
});

describe("statusPillFor", () => {
  it("marks decided mail as done", () => {
    const item = mapInboxMessage({
      id: "d1",
      sender: "a@b.com",
      subject: "Hi",
      snippet: "snip",
      take: null,
      category: "Needs Reply",
      sent_at: null,
      mailbox_email: "",
      action_required: true,
      is_unread: true,
      user_replied: false,
      user_decided: true,
    });
    expect(statusPillFor(item, statusLabels)).toEqual({
      text: "已处理",
      done: true,
      kind: "done",
    });
  });

  it("marks needs-reply as needs action", () => {
    const item = mapInboxMessage({
      id: "r1",
      sender: "a@b.com",
      subject: "Please reply",
      snippet: "snip",
      take: null,
      category: "Needs Reply",
      sent_at: null,
      mailbox_email: "",
      action_required: true,
      is_unread: true,
      user_replied: false,
    });
    expect(statusPillFor(item, statusLabels).kind).toBe("needs");
  });

  it("does not label FYI newsletters as needs action", () => {
    const item = mapInboxMessage({
      id: "f1",
      sender: "Jobright Job Alert",
      subject: "New jobs for you",
      snippet: "3 new matches",
      take: null,
      category: "FYI",
      sent_at: null,
      mailbox_email: "",
      action_required: false,
      is_unread: false,
      user_replied: false,
    });
    expect(statusPillFor(item, statusLabels)).toEqual({
      text: "知晓即可",
      done: false,
      kind: "fyi",
    });
  });

  it("labels unread non-actionable mail as unread", () => {
    const item = mapInboxMessage({
      id: "u1",
      sender: "American Airlines",
      subject: "Flash sale",
      snippet: "Save 20%",
      take: null,
      category: "FYI",
      sent_at: null,
      mailbox_email: "",
      action_required: false,
      is_unread: true,
      user_replied: false,
    });
    expect(statusPillFor(item, statusLabels)).toEqual({
      text: "未读",
      done: false,
      kind: "unread",
    });
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

describe("inbox tab scope mapping", () => {
  it("maps each UI tab to the correct API scope", () => {
    expect(tabToScope("needs_action")).toBe("needs_action");
    expect(tabToScope("unread")).toBe("unread");
    expect(tabToScope("all")).toBe("synced");
    expect(tabToScope("sms")).toBe("sms");
    expect(tabToScope("email")).toBe("synced");
  });

  it("maps API scopes back to UI tabs", () => {
    expect(scopeToTab("needs_action")).toBe("needs_action");
    expect(scopeToTab("unread")).toBe("unread");
    expect(scopeToTab("synced")).toBe("all");
    expect(scopeToTab("sms")).toBe("sms");
  });
});
