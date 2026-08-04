
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Folder,
  Inbox,
  ListTodo,
  Mic,
  PieChart,
  Send,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  Bell,
  Flag,
  MoreHorizontal,
} from "lucide-react";

type IconTileProps = {
  label: string;
  kind?: "core" | "status" | "ai";
  badge?: number;
  children: React.ReactNode;
};

function IconTile({ label, kind = "core", badge, children }: IconTileProps) {
  return (
    <div className="icon-block">
      <div className={`icon-tile ${kind}`}>
        <span className="icon-gloss" />
        {children}
        {badge ? <span className="badge">{badge}</span> : null}
      </div>
      <span>{label}</span>
    </div>
  );
}

function AlfredAvatar() {
  return (
    <div className="alfred">
      <div className="heart">♥</div>
      <div className="head">
        <div className="screen">
          <span className="eye left" />
          <span className="eye right" />
          <span className="smile" />
        </div>
      </div>
      <div className="bow">
        <span />
        <i />
        <span />
      </div>
    </div>
  );
}

function RowCard({
  icon,
  title,
  body,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  badge?: number;
}) {
  return (
    <div className="row-card">
      <div className="mini-icon">
        {icon}
        {badge ? <span className="badge small">{badge}</span> : null}
      </div>
      <div className="row-copy">
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      <span className="chevron">›</span>
    </div>
  );
}

export default function App() {
  return (
    <main className="page">
      <section className="panel left-panel">
        <header className="panel-title">
          <span className="blue-dot" />
          <div>
            <h1>图标样式预览</h1>
            <p>三种图标风格，适用于不同场景</p>
          </div>
        </header>

        <div className="group">
          <h2>1. 核心功能图标（半立体风格）</h2>
          <p>用于主要模块入口，如日历、收件箱、任务、项目等</p>
          <div className="icon-grid five">
            <IconTile label="日历"><CalendarDays /></IconTile>
            <IconTile label="收件箱" badge={12}><Inbox /></IconTile>
            <IconTile label="任务"><ListTodo /></IconTile>
            <IconTile label="项目"><Folder /></IconTile>
            <IconTile label="统计"><PieChart /></IconTile>
          </div>
        </div>

        <div className="group">
          <h2>2. 辅助状态图标（轻量描边风格）</h2>
          <p>用于状态、时间、提醒等辅助信息</p>
          <div className="icon-grid five">
            <IconTile label="时间" kind="status"><Clock3 /></IconTile>
            <IconTile label="提醒" kind="status"><Bell /></IconTile>
            <IconTile label="已完成" kind="status"><CheckCircle2 /></IconTile>
            <IconTile label="重要" kind="status"><Flag /></IconTile>
            <IconTile label="更多" kind="status"><MoreHorizontal /></IconTile>
          </div>
        </div>

        <div className="group">
          <h2>3. Alfred 操作图标（AI 风格）</h2>
          <p>用于 AI 相关操作、语音、发送等关键交互</p>
          <div className="icon-grid five">
            <IconTile label="AI 助理" kind="ai"><Sparkles /></IconTile>
            <IconTile label="语音输入" kind="ai"><Mic /></IconTile>
            <IconTile label="发送" kind="ai"><Send /></IconTile>
            <IconTile label="自动处理" kind="ai"><WandSparkles /></IconTile>
            <IconTile label="安全确认" kind="ai"><ShieldCheck /></IconTile>
          </div>
        </div>

        <div className="font-card">
          <div className="font-col">
            <span className="font-kicker">1. 标题字体（中文）</span>
            <div className="serif-cn">晚上好，<em>Rae</em></div>
            <small>Noto Serif SC / 宋体风格</small>
          </div>
          <div className="font-col">
            <span className="font-kicker">2. 品牌字体（英文 / 品牌名）</span>
            <div className="brand">Alfred</div>
            <small>Georgia / Serif</small>
          </div>
          <div className="font-col">
            <span className="font-kicker">3. 正文字体（功能文字）</span>
            <div className="sans">安排一个时间块</div>
            <small>DM Sans / 无衬线体</small>
          </div>
        </div>

        <div className="palette">
          {[
            "#07152F","#0B1D3F","#245ACB","#5A8DF4",
            "#EAF1FF","#F6F8FC","#FFFFFF","#63708A","#929CAF"
          ].map(c => (
            <div className="swatch" key={c}>
              <span style={{ background: c }} />
              <small>{c}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="panel middle-panel">
        <header className="panel-title compact">
          <span className="blue-dot" />
          <h1>图标组合示例</h1>
        </header>

        <div className="stack">
          <RowCard icon={<CalendarDays />} title="今日安排" body="查看你今天的日程与时间块" />
          <RowCard icon={<Inbox />} title="需要处理" body="8 封邮件等待你的处理" badge={8} />
          <RowCard icon={<Sparkles />} title="交给 Alfred" body="AI 帮你处理繁琐事务" />
          <RowCard icon={<ListTodo />} title="我的任务" body="查看任务列表与进度" />
          <RowCard icon={<Folder />} title="我的项目" body="查看进行中的项目" />
        </div>

        <header className="panel-title compact second">
          <span className="blue-dot" />
          <h1>状态图标应用示例</h1>
        </header>

        <div className="stack status-stack">
          <RowCard icon={<Clock3 />} title="预计 3 小时 12 分钟" body="8:47 PM – 11:59 PM" />
          <RowCard icon={<Bell />} title="提醒我" body="在开始前 15 分钟提醒" />
          <RowCard icon={<CheckCircle2 />} title="已加入日历" body="此时间块已安排成功" />
          <RowCard icon={<Flag />} title="重要任务" body="专注度高，建议优先完成" />
        </div>

        <header className="panel-title compact second">
          <span className="blue-dot" />
          <h1>Alfred 操作入口示例</h1>
        </header>

        <div className="ai-strip">
          {[<Sparkles/>,<Mic/>,<Send/>,<WandSparkles/>,<ShieldCheck/>].map((x, i) => (
            <div className="icon-tile ai small-tile" key={i}>{x}</div>
          ))}
        </div>
      </section>

      <section className="phone-wrap">
        <div className="phone">
          <div className="statusbar"><span>9:41</span><span>▮▮▮  Wi‑Fi  ▰</span></div>

          <div className="phone-top">
            <div>
              <span className="date">THURSDAY · JULY 22</span>
              <h1>晚上好，<em>Rae</em></h1>
              <p>Alfred 已准备好处理你的日程与消息。</p>
            </div>
            <div className="top-tools">
              <button><Bell size={18}/><i /></button>
              <AlfredAvatar />
            </div>
          </div>

          <div className="summary-card">
            <div className="icon-tile core compact-tile"><CalendarDays/></div>
            <div>
              <strong>今天暂无日程安排</strong>
              <span>你有一段完整的专注时间块。</span>
            </div>
            <b>›</b>
          </div>

          <div className="section-label">Alfred 建议</div>
          <div className="section-heading">
            <h2>安排一个时间块</h2>
            <span><Sparkles size={14}/> AI 推荐</span>
          </div>

          <div className="task-card">
            <div className="task-top">
              <div className="icon-tile ai compact-tile"><ListTodo/></div>
              <div>
                <span className="important">重要任务</span>
                <h3>Provide responses to the Inter-Document RFI.</h3>
                <p>Answer only what the document scope allows. Accuracy is at stake.</p>
              </div>
            </div>
            <div className="time-line">
              <span><Clock3 size={16}/> 192 分钟可用</span>
              <span>8:47 PM – 11:59 PM</span>
            </div>
            <div className="duration-row">
              <button>−15 分钟</button>
              <strong>3 小时 12 分钟</strong>
              <button>+15 分钟</button>
            </div>
            <button className="primary"><CalendarDays size={17}/> 加入日历</button>
          </div>

          <div className="inbox-title">
            <div><span>需要你处理</span><h2>收件箱</h2></div>
            <a>查看全部 ›</a>
          </div>

          <div className="mail-card">
            {[
              ["S","St. Louis Fed Research","Account Registration","8:35 PM","需处理"],
              ["S","St. Louis Fed Research","Request to Change Password","8:28 PM","需处理"]
            ].map((m, i)=>(
              <div className="mail-row" key={i}>
                <div className="mail-avatar">{m[0]}<i/></div>
                <div className="mail-copy"><span>{m[1]}</span><strong>{m[2]}</strong><p>You received a read-only account...</p></div>
                <div className="mail-meta"><time>{m[3]}</time><b>{m[4]}</b></div>
              </div>
            ))}
          </div>

          <div className="composer">
            <div className="icon-tile ai tiny"><Sparkles/></div>
            <input placeholder="告诉 Alfred 你想做什么..." />
            <button className="mic"><Mic size={18}/></button>
            <button className="send"><Send size={18}/></button>
          </div>

          <div className="bottom-nav">
            <div className="active"><CalendarDays/><span>首页</span></div>
            <div><Inbox/><span>收件箱</span></div>
            <div className="avatar-slot"><AlfredAvatar/></div>
            <div><ListTodo/><span>对话</span></div>
            <div><ShieldCheck/><span>我的</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
