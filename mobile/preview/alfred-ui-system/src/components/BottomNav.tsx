import {
  CalendarDays,
  Inbox,
  MessageCircle,
  UserRound,
} from "lucide-react";
import AlfredAvatar from "./AlfredAvatar";
import type { TabKey } from "../types";

export default function BottomNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  return (
    <nav className="bottom-nav">
      <button className={active === "home" ? "active" : ""} onClick={() => onChange("home")}>
        <CalendarDays /><span>首页</span>
      </button>
      <button className={active === "inbox" ? "active" : ""} onClick={() => onChange("inbox")}>
        <Inbox /><span>收件箱</span>
        <i className="nav-badge">8</i>
      </button>
      <button
        className={`center-avatar ${active === "alfred" ? "active" : ""}`}
        onClick={() => onChange("alfred")}
        aria-label="Open Alfred hub"
      >
        <AlfredAvatar size={70} compact />
      </button>
      <button className={active === "chat" ? "active" : ""} onClick={() => onChange("chat")}>
        <MessageCircle /><span>对话</span>
      </button>
      <button className={active === "profile" ? "active" : ""} onClick={() => onChange("profile")}>
        <UserRound /><span>我的</span>
      </button>
    </nav>
  );
}
