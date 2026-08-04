// Deep link target for albert://conversation/{id} (from keyboard 展开).

import { useLocalSearchParams, useRouter } from "expo-router";

import { ImportConversationScreen } from "@/screens/ImportConversationScreen";
import { LocaleProvider } from "@/context/LocaleContext";

export default function ConversationDeepLinkRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const conversationId = typeof params.id === "string" ? params.id : undefined;

  return (
    <LocaleProvider>
      <ImportConversationScreen
        onClose={() => router.back()}
        deepLinkConversationId={conversationId}
      />
    </LocaleProvider>
  );
}
