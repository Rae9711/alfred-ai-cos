// Workflow UI skeleton — mock fixtures for Home → Inbox → Chat flow.
// Locale-aware copy; Phase B replaces with real API calls.

import type { Locale } from "@/i18n/locales";

export type InboxSource = "email" | "wechat" | "calendar";

export type WorkflowInboxItem = {
  id: string;
  source: InboxSource;
  sender: string;
  title: string;
  summary: string;
  tags: { label: string; tone: "warn" | "accent" | "muted" }[];
  section: "reply" | "fyi";
};

export type ScheduleItem = {
  id: string;
  time: string;
  title: string;
  detail: string;
  tag?: { label: string; tone: "accent" | "warn" | "muted" };
};

export type WorkflowDraft = {
  to: string;
  subject: string;
  body: string;
};

export const DEMO_USER_NAME = "Rae";

const PROACTIVE: Record<
  Locale,
  { prompt: string; cta: string; subject: string }
> = {
  en: {
    prompt:
      "You still need to confirm the final Q3 proposal version before EOD. Want me to handle it now?",
    cta: "Yes, help me confirm",
    subject: "Q3 proposal — final version",
  },
  zh: {
    prompt:
      "今天回以前需要确认 Q3 提案的最终版本。想让我现在帮您确认吗？",
    cta: "好，帮我确认",
    subject: "Q3 提案 — 最终版本",
  },
};

export function getWorkflowProactive(locale: Locale) {
  const copy = PROACTIVE[locale];
  return {
    messageId: "wf-proactive-q3",
    sender: "Sarah Chen",
    subject: copy.subject,
    prompt: copy.prompt,
    cta: copy.cta,
  };
}

const SCHEDULE: Record<Locale, ScheduleItem[]> = {
  en: [
    {
      id: "s1",
      time: "09:30",
      title: "Team standup",
      detail: "Zoom · 45 min",
    },
    {
      id: "s2",
      time: "12:00",
      title: "Lunch with Alex",
      detail: "Bistro Nord",
      tag: { label: "Alfred booked", tone: "accent" },
    },
    {
      id: "s3",
      time: "15:00",
      title: "Client proposal review",
      detail: "WeWork · leave by 14:20",
    },
    {
      id: "s4",
      time: "18:30",
      title: "Hotel confirmation deadline",
      detail: "Tokyo trip",
      tag: { label: "Pending", tone: "warn" },
    },
  ],
  zh: [
    {
      id: "s1",
      time: "09:30",
      title: "团队周会",
      detail: "Zoom · 45 分钟",
    },
    {
      id: "s2",
      time: "12:00",
      title: "午餐",
      detail: "Bistro Nord",
      tag: { label: "管家已预约", tone: "accent" },
    },
    {
      id: "s3",
      time: "15:00",
      title: "客户提案评审",
      detail: "WeWork · 14:20 出发",
    },
    {
      id: "s4",
      time: "18:30",
      title: "酒店截止确认",
      detail: "东京行程",
      tag: { label: "待处理", tone: "warn" },
    },
  ],
};

export function getWorkflowSchedule(locale: Locale): ScheduleItem[] {
  return SCHEDULE[locale];
}

const INBOX: Record<Locale, WorkflowInboxItem[]> = {
  en: [
    {
      id: "wf-1",
      source: "email",
      sender: "Sarah Chen",
      title: "Q3 proposal — final version",
      summary:
        "Sarah needs your sign-off on the redline before EOD. Alfred already read the thread.",
      tags: [
        { label: "Urgent", tone: "warn" },
        { label: "Needs reply", tone: "accent" },
      ],
      section: "reply",
    },
    {
      id: "wf-2",
      source: "email",
      sender: "James Wu",
      title: "Contract revision notes",
      summary:
        "Legal sent tracked changes on section 4. Two clauses need your call.",
      tags: [{ label: "Needs reply", tone: "accent" }],
      section: "reply",
    },
    {
      id: "wf-3",
      source: "calendar",
      sender: "Zoom",
      title: "Investor sync confirmed",
      summary: "Thursday 3pm — calendar hold is on your Google Calendar.",
      tags: [{ label: "Scheduled", tone: "muted" }],
      section: "fyi",
    },
    {
      id: "wf-4",
      source: "email",
      sender: "United Airlines",
      title: "Check in opens for SFO → NRT",
      summary: "Window opens in 6 hours. Seat 14A held.",
      tags: [{ label: "Travel", tone: "muted" }],
      section: "fyi",
    },
  ],
  zh: [
    {
      id: "wf-1",
      source: "email",
      sender: "张总",
      title: "Q3 提案确认",
      summary: "张总需要在今天下班前确认红线版本。管家已读完邮件。",
      tags: [
        { label: "紧急", tone: "warn" },
        { label: "需回复", tone: "accent" },
      ],
      section: "reply",
    },
    {
      id: "wf-2",
      source: "email",
      sender: "王律师",
      title: "合同修订意见",
      summary: "法务发来第 4 条修订意见，有两处需要您拍板。",
      tags: [{ label: "需回复", tone: "accent" }],
      section: "reply",
    },
    {
      id: "wf-3",
      source: "calendar",
      sender: "Zoom",
      title: "投资人会议已确认",
      summary: "周四下午 3 点 — 已写入 Google 日历。",
      tags: [{ label: "已安排", tone: "muted" }],
      section: "fyi",
    },
    {
      id: "wf-4",
      source: "email",
      sender: "United Airlines",
      title: "SFO → NRT 值机开放",
      summary: "6 小时后开放值机，座位 14A 已预留。",
      tags: [{ label: "出行", tone: "muted" }],
      section: "fyi",
    },
  ],
};

export function getWorkflowInbox(locale: Locale): WorkflowInboxItem[] {
  return INBOX[locale];
}

const DRAFTS: Record<Locale, Record<string, WorkflowDraft>> = {
  en: {
    "wf-1": {
      to: "sarah.chen@company.com",
      subject: "Re: Q3 proposal — final version",
      body: [
        "Hi Sarah,",
        "",
        "Confirmed — the attached redline is the final version for Q3. Legal's section 4 edits are approved on my side.",
        "",
        "Let me know if you need anything else before EOD.",
        "",
        "Best,",
        "Rae",
      ].join("\n"),
    },
    "wf-2": {
      to: "james.wu@lawfirm.com",
      subject: "Re: Contract revision notes",
      body: [
        "Hi James,",
        "",
        "Thanks for the markup. I'm fine with clause 4.2 as written and prefer option B for the indemnity language.",
        "",
        "Rae",
      ].join("\n"),
    },
    "wf-proactive-q3": {
      to: "sarah.chen@company.com",
      subject: "Re: Q3 proposal — final version",
      body: [
        "Hi Sarah,",
        "",
        "Confirmed — the attached redline is the final version for Q3.",
        "",
        "Best,",
        "Rae",
      ].join("\n"),
    },
  },
  zh: {
    "wf-1": {
      to: "zhang@company.com",
      subject: "回复：Q3 提案确认",
      body: [
        "张总您好，",
        "",
        "确认 — 附件中的红线版本为 Q3 最终版。法务第 4 条的修改我这边已认可。",
        "",
        "下班前如需其他调整请告诉我。",
        "",
        "此致",
        "Rae",
      ].join("\n"),
    },
    "wf-2": {
      to: "wang@lawfirm.com",
      subject: "回复：合同修订意见",
      body: [
        "王律师您好，",
        "",
        "感谢修订。第 4.2 条按现稿可以，赔偿条款我倾向方案 B。",
        "",
        "Rae",
      ].join("\n"),
    },
    "wf-proactive-q3": {
      to: "zhang@company.com",
      subject: "回复：Q3 提案确认",
      body: [
        "张总您好，",
        "",
        "确认 — 附件红线版本为 Q3 最终版。",
        "",
        "此致",
        "Rae",
      ].join("\n"),
    },
  },
};

export function draftForMessage(
  messageId: string,
  locale: Locale,
): WorkflowDraft {
  const table = DRAFTS[locale];
  return (
    table[messageId] ?? {
      to: locale === "zh" ? "recipient@example.com" : "recipient@example.com",
      subject: locale === "zh" ? "回复：您的邮件" : "Re: Your message",
      body:
        locale === "zh"
          ? "感谢您的来信 — 我会尽快跟进。\n\nRae"
          : "Thanks for your note — I'll follow up shortly.\n\nBest,\nRae",
    }
  );
}

export function inboxItemById(
  id: string,
  locale: Locale,
): WorkflowInboxItem | undefined {
  return getWorkflowInbox(locale).find((m) => m.id === id);
}

export const SOURCE_FILTER_IDS = [
  { id: "all", match: null as InboxSource | null },
  { id: "email", match: "email" as const },
  { id: "wechat", match: "wechat" as const },
  { id: "calendar", match: "calendar" as const },
];
