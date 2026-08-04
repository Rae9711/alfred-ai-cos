import { useState } from "react";
import { motion } from "framer-motion";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Inbox,
  Layers3,
  MessageCircle,
  Mic,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";

import "./alfred-home.css";

type NavItem = "home" | "inbox" | "assistant" | "chat" | "profile";

interface EmailItem {
  id: number;
  sender: string;
  subject: string;
  preview: string;
  time: string;
  status: "action" | "done";
}

const emails: EmailItem[] = [
  {
    id: 1,
    sender: "St. Louis Fed Research",
    subject: "Account Registration",
    preview: "You received a read-only account creation notification...",
    time: "8:35 PM",
    status: "action",
  },
  {
    id: 2,
    sender: "St. Louis Fed Research",
    subject: "Request to Change Password",
    preview: "Your password reset link expires in 20 minutes...",
    time: "8:28 PM",
    status: "action",
  },
  {
    id: 3,
    sender: "St. Louis Fed Research",
    subject: "Account Registration",
    preview: "Your account creation has been confirmed.",
    time: "8:16 PM",
    status: "done",
  },
];

function AlfredMiniAvatar({ size = 68 }: { size?: number }) {
  return (
    <motion.div
      className="alfred-avatar"
      style={{ width: size, height: size }}
      animate={{ y: [0, -4, 0] }}
      transition={{
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      <div className="avatar-heart">♥</div>

      <div className="avatar-head">
        <div className="avatar-ear avatar-ear-left" />
        <div className="avatar-ear avatar-ear-right" />

        <div className="avatar-screen">
          <motion.span
            className="avatar-eye"
            animate={{ scaleY: [1, 1, 0.1, 1] }}
            transition={{
              duration: 4.5,
              repeat: Infinity,
              times: [0, 0.88, 0.92, 1],
            }}
          />
          <motion.span
            className="avatar-eye"
            animate={{ scaleY: [1, 1, 0.1, 1] }}
            transition={{
              duration: 4.5,
              repeat: Infinity,
              times: [0, 0.88, 0.92, 1],
            }}
          />

          <span className="avatar-smile" />
        </div>
      </div>

      <div className="avatar-body">
        <span className="avatar-bow-left" />
        <span className="avatar-bow-center" />
        <span className="avatar-bow-right" />
      </div>
    </motion.div>
  );
}

export default function AlfredHome() {
  const [activeNav, setActiveNav] = useState<NavItem>("home");
  const [message, setMessage] = useState("");
  const [scheduled, setScheduled] = useState(false);

  function handleSubmit() {
    const trimmed = message.trim();

    if (!trimmed) return;

    console.log("Send to Alfred:", trimmed);
    setMessage("");
  }

  return (
    <div className="alfred-app">
      <div className="background-orb background-orb-one" />
      <div className="background-orb background-orb-two" />

      <main className="app-shell">
        <header className="top-bar">
          <div>
            <p className="eyebrow">THURSDAY · JULY 22</p>

            <h1 className="greeting">
              晚上好，<span>Rae</span>
            </h1>

            <p className="greeting-description">
              Alfred 已准备好处理你的日程与消息。
            </p>
          </div>

          <div className="header-actions">
            <button className="icon-button" aria-label="Notifications">
              <Bell size={20} />
              <span className="notification-dot" />
            </button>

            <AlfredMiniAvatar size={76} />
          </div>
        </header>

        <section className="daily-summary">
          <div className="summary-icon">
            <CalendarDays size={23} />
          </div>

          <div className="summary-copy">
            <strong>今天暂无日程安排</strong>
            <span>你有一段完整的专注时间。</span>
          </div>

          <button className="ghost-button" aria-label="View schedule">
            <ChevronRight size={21} />
          </button>
        </section>

        <section className="section">
          <div className="section-header">
            <div>
              <p className="section-label">ALFRED 建议</p>
              <h2>安排一个时间块</h2>
            </div>

            <div className="ai-label">
              <Sparkles size={14} />
              AI 推荐
            </div>
          </div>

          <motion.article
            className="focus-card"
            whileHover={{ y: -3 }}
            transition={{ duration: 0.2 }}
          >
            <div className="focus-card-top">
              <div className="document-icon">
                <Layers3 size={28} />
              </div>

              <div className="focus-title">
                <span className="focus-kicker">重要任务</span>
                <h3>Provide responses to the Inter-Document RFI.</h3>
                <p>
                  Answer only what the document scope allows. Accuracy is at
                  stake.
                </p>
              </div>

              <Sparkles className="focus-sparkle" size={24} />
            </div>

            <div className="focus-divider" />

            <div className="time-row">
              <div className="time-description">
                <Clock3 size={18} />
                <span>192 分钟可用</span>
              </div>

              <strong>8:47 PM — 11:59 PM</strong>
            </div>

            <div className="time-controls">
              <button type="button">−15 分钟</button>
              <span>3 小时 12 分钟</span>
              <button type="button">+15 分钟</button>
            </div>

            <button
              className={`primary-button ${scheduled ? "is-complete" : ""}`}
              type="button"
              onClick={() => setScheduled(true)}
            >
              {scheduled ? (
                <>
                  <Check size={19} />
                  已加入日历
                </>
              ) : (
                <>
                  <CalendarDays size={19} />
                  加入日历
                </>
              )}
            </button>
          </motion.article>
        </section>

        <section className="section inbox-section">
          <div className="section-header inbox-header">
            <div>
              <p className="section-label">需要你处理</p>
              <h2>收件箱</h2>
            </div>

            <button className="text-button" type="button">
              查看全部
              <ChevronRight size={17} />
            </button>
          </div>

          <div className="email-card">
            {emails.map((email, index) => (
              <article className="email-row" key={email.id}>
                <div className="sender-avatar">
                  {email.sender.charAt(0)}
                  {email.status === "action" && (
                    <span className="sender-status" />
                  )}
                </div>

                <div className="email-content">
                  <div className="email-meta">
                    <span>{email.sender}</span>
                    <time>{email.time}</time>
                  </div>

                  <strong>{email.subject}</strong>
                  <p>{email.preview}</p>
                </div>

                <span
                  className={`status-pill ${
                    email.status === "done" ? "status-done" : ""
                  }`}
                >
                  {email.status === "done" ? "已处理" : "需处理"}
                </span>

                {index < emails.length - 1 && (
                  <div className="email-divider" />
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="command-box">
          <div className="command-sparkle">
            <Sparkles size={19} />
          </div>

          <input
            type="text"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleSubmit();
            }}
            placeholder="告诉 Alfred 你想做什么..."
          />

          <button className="voice-button" type="button" aria-label="Voice input">
            <Mic size={20} />
          </button>

          <button
            className="send-button"
            type="button"
            aria-label="Send"
            onClick={handleSubmit}
            disabled={!message.trim()}
          >
            <Send size={19} />
          </button>
        </section>

        <nav className="bottom-navigation">
          <NavButton
            active={activeNav === "home"}
            icon={<CalendarDays size={22} />}
            label="首页"
            onClick={() => setActiveNav("home")}
          />

          <NavButton
            active={activeNav === "inbox"}
            icon={<Inbox size={22} />}
            label="收件箱"
            onClick={() => setActiveNav("inbox")}
          />

          <button
            type="button"
            className="assistant-navigation-button"
            onClick={() => setActiveNav("assistant")}
            aria-label="Open Alfred"
          >
            <AlfredMiniAvatar size={70} />
          </button>

          <NavButton
            active={activeNav === "chat"}
            icon={<MessageCircle size={22} />}
            label="对话"
            onClick={() => setActiveNav("chat")}
          />

          <NavButton
            active={activeNav === "profile"}
            icon={<UserRound size={22} />}
            label="我的"
            onClick={() => setActiveNav("profile")}
          />
        </nav>
      </main>
    </div>
  );
}

interface NavButtonProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function NavButton({ active, icon, label, onClick }: NavButtonProps) {
  return (
    <button
      type="button"
      className={`nav-button ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
