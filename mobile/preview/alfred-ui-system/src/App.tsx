import { useState } from "react";
import PageShell from "./components/PageShell";
import HomePage from "./pages/HomePage";
import InboxPage from "./pages/InboxPage";
import AlfredHubPage from "./pages/AlfredHubPage";
import ChatPage from "./pages/ChatPage";
import ProfilePage from "./pages/ProfilePage";
import type { TabKey } from "./types";

export default function App() {
  const [active, setActive] = useState<TabKey>("home");

  return (
    <div className="app-canvas">
      <PageShell active={active} onChange={setActive}>
        {active === "home" && <HomePage />}
        {active === "inbox" && <InboxPage />}
        {active === "alfred" && <AlfredHubPage />}
        {active === "chat" && <ChatPage />}
        {active === "profile" && <ProfilePage />}
      </PageShell>
    </div>
  );
}
