import { useEffect, useRef } from "react";
import * as SecureStore from "expo-secure-store";

import { useShell } from "@/components/Shell";
import { useLocale } from "@/context/LocaleContext";
import type { AppInboxItem } from "@/lib/inbox";

const STORAGE_KEY = "sms_share_tip_shown";

/** One-time toast when the first forwarded SMS appears in the inbox. */
export function useSmsShareTip(items: AppInboxItem[]) {
  const { showToast } = useShell();
  const { t } = useLocale();
  const prevSmsCount = useRef(0);

  useEffect(() => {
    const smsCount = items.filter((m) => m.source === "sms").length;
    const wasEmpty = prevSmsCount.current === 0;
    prevSmsCount.current = smsCount;

    if (!wasEmpty || smsCount === 0) return;

    void (async () => {
      const shown = await SecureStore.getItemAsync(STORAGE_KEY);
      if (shown) return;
      showToast(t.settings.smsFirstForwardTip, { duration: 5500 });
      await SecureStore.setItemAsync(STORAGE_KEY, "1");
    })();
  }, [items, showToast, t.settings.smsFirstForwardTip]);
}
