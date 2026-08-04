import {
  Bell,
  CalendarDays,
  Clock3,
  Inbox,
  ListTodo,
} from "lucide-react";
import AlfredAvatar from "../components/AlfredAvatar";
import { IconTile } from "../components/IconTile";

export default function HomePage() {
  return (
    <div className="page-stack">
      <header className="home-header">
        <div>
          <span className="eyebrow">管家</span>
          <h1>下午好，<em>Rae</em></h1>
          <p>安排日程、发短信、设提醒，或速记 — 其余交给我。</p>
        </div>
        <div className="header-tools">
          <button className="round-button"><Bell /></button>
          <AlfredAvatar size={88} />
        </div>
      </header>

      <section className="summary-card surface">
        <IconTile icon={CalendarDays} tone="blue" />
        <div>
          <strong>今天暂无日程安排</strong>
          <span>你有一段完整的专注时间块。</span>
        </div>
        <button className="chevron-button">›</button>
      </section>

      <section>
        <div className="section-kicker">Alfred 建议</div>
        <div className="section-heading">
          <h2>安排一个时间块</h2>
          <span className="pill ai"><Sparkles /> AI 推荐</span>
        </div>

        <article className="task-card surface">
          <div className="task-main">
            <IconTile icon={ListTodo} tone="purple" />
            <div>
              <span className="mini-tag">重要任务</span>
              <h3>Provide responses to the Inter-Document RFI.</h3>
              <p>Answer only what the document scope allows. Accuracy is at stake.</p>
            </div>
          </div>

          <div className="task-meta">
            <span><Clock3 /> 192 分钟可用</span>
            <span>8:47 PM – 11:59 PM</span>
          </div>

          <div className="duration-row">
            <button>−15 分钟</button>
            <strong>3 小时 12 分钟</strong>
            <button>+15 分钟</button>
          </div>

          <button className="primary-button"><CalendarDays /> 加入日历</button>
        </article>
      </section>

      <section>
        <div className="section-heading inbox-heading">
          <div>
            <span className="section-kicker">需要你处理</span>
            <h2>收件箱</h2>
          </div>
          <button className="link-button">查看全部 ›</button>
        </div>

        <div className="mail-preview surface">
          {[
            ["St. Louis Fed Research", "Account Registration", "8:35 PM"],
            ["St. Louis Fed Research", "Request to Change Password", "8:28 PM"],
          ].map((item, index) => (
            <div className="mail-preview-row" key={index}>
              <div className="sender-dot">S<i /></div>
              <div>
                <span>{item[0]}</span>
                <strong>{item[1]}</strong>
                <p>You received a read-only account...</p>
              </div>
              <div className="mail-status">
                <time>{item[2]}</time>
                <b>需处理</b>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
