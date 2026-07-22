import {
  Check,
  Clock3,
  Inbox,
  Mail,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { IconTile } from "../components/IconTile";

const items = [
  { sender: "St. Louis Fed Research", subject: "Account Registration", time: "8:35 PM", status: "需处理", tone: "purple" as const },
  { sender: "St. Louis Fed Research", subject: "Request to Change Password", time: "8:28 PM", status: "需处理", tone: "purple" as const },
  { sender: "St. Louis Fed Research", subject: "Account Registration", time: "8:16 PM", status: "已处理", tone: "blue" as const },
  { sender: "Slack", subject: "You have a new mention", time: "7:42 PM", status: "其他", tone: "neutral" as const },
  { sender: "Calendar", subject: "Daily Agenda", time: "7:30 PM", status: "其他", tone: "blue" as const },
];

export default function InboxPage() {
  return (
    <div className="page-stack inbox-page">
      <header className="simple-header">
        <h1>收件箱</h1>
        <div className="header-icon-group">
          <button><Search /></button>
          <button><SlidersHorizontal /></button>
        </div>
      </header>

      <div className="filter-row">
        {["全部 24", "需处理 8", "已处理 16", "其他⌄"].map((label, i) => (
          <button className={i === 0 ? "active" : ""} key={label}>{label}</button>
        ))}
      </div>

      <div className="inbox-list">
        {items.map((item, index) => (
          <article className="inbox-card surface" key={index}>
            <div className="inbox-main">
              <IconTile icon={item.sender === "Calendar" ? Inbox : Mail} tone={item.tone} />
              <div className="inbox-copy">
                <div className="inbox-meta">
                  <span>{item.sender}</span>
                  <time>{item.time}</time>
                </div>
                <h3>{item.subject}</h3>
                <p>
                  {item.sender === "Slack"
                    ? "@Rae mentioned you in #project-alfred."
                    : item.sender === "Calendar"
                    ? "Your agenda for Thu, Jul 22 is ready."
                    : "You received a read-only account creation notification..."}
                </p>
              </div>
              <span className={`status-chip ${item.status === "已处理" ? "done" : ""}`}>{item.status}</span>
            </div>
            {index < 2 && (
              <div className="quick-actions">
                <button><Mail /> 快速回复</button>
                <button><Check /> 标记完成</button>
                <button><Clock3 /> 延后</button>
                <button><MoreHorizontal /></button>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
