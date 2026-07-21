import { describe, expect, it } from "vitest";

import type {
  ConversationAction,
  ConversationInboxResponse,
  ParsedConversation,
} from "@albert/shared-types";

/** Mirror of backend noise down-weight heuristic for UI tests. */
function isNoiseContent(content: string): boolean {
  return /^(好|嗯|哦|噢|ok|okay|kk|收到|哈哈+|呵呵+|已吃|已读|\[.*?\]|（.*?）)$/i.test(
    content.trim(),
  );
}

function selectedMessageCount(conversation: ParsedConversation): number {
  return conversation.messages.filter((m) => m.is_selected).length;
}

function summarizeInbox(inbox: ConversationInboxResponse): string {
  const { tasks = 0, follow_ups = 0, commitments = 0 } = inbox.counts;
  const parts: string[] = [];
  if (tasks) parts.push(`${tasks} task${tasks === 1 ? "" : "s"}`);
  if (follow_ups) parts.push(`${follow_ups} follow-up${follow_ups === 1 ? "" : "s"}`);
  if (commitments) parts.push(`${commitments} commitment${commitments === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : "Nothing pending";
}

function shouldOfferReminder(action: ConversationAction): boolean {
  return action.tier === "explicit_time" || Boolean(action.start) || Boolean(action.due_date);
}

describe("conversation UI helpers", () => {
  it("detects noise acknowledgements", () => {
    expect(isNoiseContent("已吃")).toBe(true);
    expect(isNoiseContent("ok")).toBe(true);
    expect(isNoiseContent("昨晚的感觉还没消化")).toBe(false);
  });

  it("counts selected context messages", () => {
    const conversation: ParsedConversation = {
      id: "c1",
      source: "wechat",
      participants: [{ name: "6330", is_self: false }],
      imported_at: new Date().toISOString(),
      messages: [
        {
          id: "1",
          sender: "6330",
          timestamp: null,
          content: "我需要审一下",
          role: "other",
          is_selected: true,
          weight: 1,
        },
        {
          id: "2",
          sender: "Rui",
          timestamp: null,
          content: "已吃",
          role: "self",
          is_selected: false,
          weight: 0.3,
        },
      ],
    };
    expect(selectedMessageCount(conversation)).toBe(1);
  });

  it("summarizes conversation inbox counts", () => {
    expect(
      summarizeInbox({
        items: [],
        counts: { tasks: 2, follow_ups: 1, commitments: 0, calendar_events: 0 },
      }),
    ).toBe("2 tasks · 1 follow-up");
  });

  it("only offers reminders for explicit-time tiers", () => {
    const followUp: ConversationAction = {
      id: "a1",
      type: "follow_up",
      title: "问对方状态",
      due_date: null,
      start: null,
      end: null,
      suggested_time: "tonight",
      confidence: 0.8,
      evidence: "我之后再告诉你",
      evidence_message_ids: ["m1"],
      tier: "follow_up_suggestion",
      status: "suggested",
    };
    const calendar: ConversationAction = {
      ...followUp,
      id: "a2",
      type: "calendar_event",
      title: "与 Alex 见面",
      start: "2026-07-22T15:00:00-04:00",
      end: "2026-07-22T16:00:00-04:00",
      tier: "explicit_time",
    };
    expect(shouldOfferReminder(followUp)).toBe(false);
    expect(shouldOfferReminder(calendar)).toBe(true);
  });
});
