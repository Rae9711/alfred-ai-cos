import { ClipboardPaste, Sparkles } from "lucide-react";
import { IconTile } from "../components/IconTile";

export default function ChatPage() {
  return (
    <div className="page-stack chat-page">
      <header className="simple-header">
        <div>
          <span className="eyebrow">对话</span>
          <h1>对话</h1>
        </div>
        <div className="header-icon-group">
          <IconTile icon={Sparkles} tone="purple" size="sm" />
        </div>
      </header>

      <p className="chat-lead">
        把对话变成 <em>可执行行动</em>。粘贴微信多选复制内容，管家会起草回复并提取跟进事项。
      </p>

      <button className="surface paste-card">
        <IconTile icon={ClipboardPaste} tone="purple" />
        <div>
          <strong>从剪贴板导入</strong>
          <span>粘贴微信多选聊天，管家会起草回复并提取跟进事项。</span>
        </div>
      </button>

      <div className="or-divider">或粘贴到下方</div>

      <textarea
        className="paste-area surface"
        readOnly
        placeholder={"6330\n我需要审一下\n\nRui\n一吃一堆"}
      />

      <button className="primary-button">
        <Sparkles /> 解析对话
      </button>

      <p className="chat-hint">也可以用 Alfred 键盘的「展开」把对话交到 App 里。</p>
    </div>
  );
}
