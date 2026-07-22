import {
  AppWindow,
  Bell,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Database,
  Info,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import AlfredAvatar from "../components/AlfredAvatar";
import { IconTile } from "../components/IconTile";

const rows = [
  [CalendarDays, "我的计划"],
  [Sparkles, "快捷指令"],
  [AppWindow, "集成应用"],
  [Database, "数据与隐私"],
  [CircleHelp, "帮助与反馈"],
  [Info, "关于 Alfred"],
] as const;

export default function ProfilePage() {
  return (
    <div className="page-stack profile-page">
      <header className="simple-header profile-title">
        <h1>我的</h1>
        <button><Settings /></button>
      </header>

      <section className="profile-hero">
        <AlfredAvatar size={112} />
        <div>
          <div className="profile-name-row">
            <h2>Ray</h2>
            <span>Pro</span>
          </div>
          <p>ruiraywang97@gmail.com</p>
        </div>
      </section>

      <section className="membership-card surface">
        <span>Alfred Pro 会员</span>
        <div>到期时间：2025.12.31 <ChevronRight /></div>
      </section>

      <section className="profile-shortcuts">
        {[
          [UserRound, "个人信息"],
          [Settings, "偏好设置"],
          [Bell, "通知设置"],
          [ShieldCheck, "安全中心"],
        ].map(([Icon, label]) => (
          <button className="shortcut-card surface" key={label}>
            <IconTile icon={Icon as any} tone="blue" size="sm" />
            <span>{label as string}</span>
          </button>
        ))}
      </section>

      <section className="stats-card surface">
        <div className="stats-header">
          <h3>AI 统计</h3>
          <button>本周⌄</button>
        </div>
        <div className="stats-grid">
          {[
            ["对话次数", "28"],
            ["节省时间", "12.6 小时"],
            ["完成任务", "36"],
            ["处理邮件", "48"],
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-list surface">
        {rows.map(([Icon, label], index) => (
          <button key={label}>
            <Icon />
            <span>{label}</span>
            {index === rows.length - 1 ? <small>v1.2.0</small> : null}
            <ChevronRight />
          </button>
        ))}
      </section>
    </div>
  );
}
