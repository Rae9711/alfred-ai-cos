// Keyboard / App Group diagnostics — real status, not a vague “已同步”.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { getToken } from "@/api/auth";
import { Ic } from "@/components/icons";
import { Btn, Eyebrow, IconBtn, Meta, Serif } from "@/components/ui";
import { syncAuthToAppGroup } from "@/lib/appGroupHandoff";
import { colors, fonts, layout } from "@/theme/theme";

type DiagRow = {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "muted";
};

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function KeyboardDiagnosticsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<DiagRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      if (Platform.OS !== "ios") {
        setRows([
          { label: "Platform", value: "仅 iOS 支持键盘扩展", tone: "muted" },
        ]);
        return;
      }

      const {
        getKeyboardLastSeen,
        getSharedAuthToken,
        getSharedAuthTokenUpdatedAt,
        isAppGroupAvailable,
        isSharedStorageNativeAvailable,
      } = await import("alfred-shared-storage");

      const native = isSharedStorageNativeAvailable();
      if (!native) {
        setRows([
          {
            label: "Native module",
            value: "未链接 — 需自定义/开发客户端",
            tone: "warn",
          },
          {
            label: "Keyboard Extension",
            value: "无法从主 App 检测，请确认设置→键盘已添加 Alfred",
            tone: "muted",
          },
        ]);
        return;
      }

      const [groupOk, token, updatedAt, lastSeen, appToken] = await Promise.all([
        isAppGroupAvailable(),
        getSharedAuthToken(),
        getSharedAuthTokenUpdatedAt(),
        getKeyboardLastSeen(),
        getToken(),
      ]);

      const next: DiagRow[] = [
        {
          label: "Keyboard Extension",
          value: lastSeen
            ? `已检测到（曾于 ${formatTs(lastSeen)} 使用）`
            : "无法从主 App 检测，请确认设置→键盘已添加 Alfred",
          tone: lastSeen ? "ok" : "muted",
        },
        {
          label: "App Group",
          value: groupOk ? "可访问" : "不可访问",
          tone: groupOk ? "ok" : "warn",
        },
        {
          label: "Auth Token",
          value: token ? "已写入" : "未写入",
          tone: token ? "ok" : "warn",
        },
        {
          label: "Token Updated",
          value: formatTs(updatedAt),
          tone: updatedAt ? "ok" : "muted",
        },
        {
          label: "Full Access",
          value: "请在系统设置中开启",
          tone: "muted",
        },
      ];

      if (appToken && !token) {
        next.push({
          label: "提示",
          value: "主 App 已登录，但 App Group 尚无 token — 点下方同步",
          tone: "warn",
        });
      }

      setRows(next);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sync = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const token = await getToken();
      const result = await syncAuthToAppGroup(token);
      if (!result.ok) {
        setNote(result.error ?? "同步失败");
      } else {
        setNote(token ? "已同步键盘登录状态" : "已清除 App Group token（未登录）");
      }
      await refresh();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "同步失败");
      setBusy(false);
    }
  }, [refresh]);

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <IconBtn onPress={() => router.back()}>
          <Ic.Close size={18} color={colors.ink2} />
        </IconBtn>
        <Eyebrow>键盘诊断</Eyebrow>
        <View style={styles.topSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Serif size={26} style={styles.heading}>
          键盘与共享容器
        </Serif>
        <Meta style={styles.sub}>
          Full Access 只能由键盘自身感知；主 App 无法读取该开关，请在系统设置中开启。
        </Meta>

        <View style={styles.card}>
          {rows.map((row, i) => (
            <View
              key={row.label}
              style={[styles.row, i === rows.length - 1 && styles.rowLast]}
            >
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text
                style={[
                  styles.rowValue,
                  row.tone === "ok" && styles.ok,
                  row.tone === "warn" && styles.warn,
                  row.tone === "muted" && styles.muted,
                ]}
              >
                {row.value}
              </Text>
            </View>
          ))}
          {busy && rows.length === 0 ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          ) : null}
        </View>

        <Btn
          label={busy ? "处理中…" : "同步键盘登录状态"}
          kind="accent"
          full
          disabled={busy}
          onPress={() => void sync()}
          style={{ marginTop: 16 }}
        />
        <Pressable onPress={() => void refresh()} style={styles.refresh}>
          <Text style={styles.refreshText}>刷新状态</Text>
        </Pressable>
        {note ? <Text style={styles.note}>{note}</Text> : null}

        <Text style={styles.help}>
          设置路径：设置 → 通用 → 键盘 → 键盘 → 添加 Alfred，并开启「允许完全访问」。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.padX,
    paddingTop: layout.topPad,
    paddingBottom: 8,
  },
  topSpacer: { width: 36 },
  content: { paddingHorizontal: layout.padX, paddingBottom: 40 },
  heading: { marginTop: 8, marginBottom: 8 },
  sub: { marginBottom: 16, lineHeight: 20 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
    overflow: "hidden",
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
    gap: 4,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  rowValue: { fontSize: 15, color: colors.ink, lineHeight: 21 },
  ok: { color: colors.success },
  warn: { color: colors.warn },
  muted: { color: colors.ink3 },
  refresh: { alignItems: "center", marginTop: 12, padding: 8 },
  refreshText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.ink3,
  },
  note: { color: colors.warn, fontSize: 13, marginTop: 8, textAlign: "center" },
  help: {
    marginTop: 24,
    fontSize: 13,
    lineHeight: 20,
    color: colors.ink3,
  },
});
