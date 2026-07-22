// Chats tab — paste-conversation workstation by default.
// Inbox → Reply still uses AskScreen when Workflow `thread` is set.

import { useWorkflow } from "@/context/WorkflowContext";
import { AskScreen } from "@/screens/AskScreen";
import { ImportConversationScreen } from "@/screens/ImportConversationScreen";

export function ChatsScreen() {
  const { thread } = useWorkflow();

  // Inbox → reply / delegate still uses the existing Ask task-thread UI.
  if (thread) {
    return <AskScreen />;
  }

  // Primary empty path: same paste → context → results flow as /import.
  return <ImportConversationScreen />;
}
