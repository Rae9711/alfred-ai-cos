// Full-screen WeChat conversation import — paste → context → replies + actions.

import { useRouter } from "expo-router";

import { ImportConversationScreen } from "@/screens/ImportConversationScreen";
import { LocaleProvider } from "@/context/LocaleContext";

export default function ImportRoute() {
  const router = useRouter();
  return (
    <LocaleProvider>
      <ImportConversationScreen onClose={() => router.back()} />
    </LocaleProvider>
  );
}
