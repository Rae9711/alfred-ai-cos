import { CalendarDays, Bell, Mail, MessageSquare, Mic, Send, Sparkles } from "lucide-react";
import AlfredAvatar from "../components/AlfredAvatar";
import { IconTile } from "../components/IconTile";

const ACTIONS = [
  { label: "日程", tone: "blue" as const, icon: CalendarDays },
  { label: "邮件", tone: "purple" as const, icon: Mail },
  { label: "短信", tone: "green" as const, icon: MessageSquare },
  { label: "提醒", tone: "yellow" as const, icon: Bell },
];

export default function AlfredHubPage() {
  return (
    <div className="page-stack alfred-hub-page">
      <div className="hub-hero">
        <span className="eyebrow">管家</span>
        <AlfredAvatar size={112} />
        <h1>下午好，<em>Rae</em></h1>
        <p>查/订日历、按姓名起草短信或邮件、设置提醒 — 发送前都会先请你确认。</p>
      </div>

      <div className="hub-actions">
        {ACTIONS.map((a) => (
          <button key={a.label} className="hub-chip">
            <IconTile icon={a.icon} tone={a.tone} size="sm" />
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      <article className="surface hub-bubble">
        <p>我可以帮你查看或预订日历、按名字起草短信或邮件、设置提醒 — 发送前都会先请你确认。</p>
      </article>

      <div className="composer hub-composer surface">
        <button aria-label="voice"><Mic /></button>
        <input placeholder="问管家…" readOnly />
        <button className="send" aria-label="send"><Send /></button>
        <button aria-label="spark"><Sparkles /></button>
      </div>
    </div>
  );
}
