import type { ReactNode } from "react";
import BottomNav from "./BottomNav";
import type { TabKey } from "../types";

export default function PageShell({
  active,
  onChange,
  children,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  children: ReactNode;
}) {
  return (
    <div className="phone-shell">
      <div className="status-bar">
        <strong>16:27</strong>
        <span>▮▮▮  Wi‑Fi  ▰</span>
      </div>
      <div className="screen-content">{children}</div>
      <BottomNav active={active} onChange={onChange} />
    </div>
  );
}
