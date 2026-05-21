// Action approval queue (PRD 10.6, 17.3). Each pending action shows what it does,
// its content, and its risk. Level 4-5 actions require an explicit second confirm.

import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ActionProposal } from "@albert/shared-types";

import { api } from "@/api/client";
import { colors, spacing } from "@/theme/theme";

const RISK_LABEL: Record<number, string> = {
  0: "Read-only",
  1: "Internal prep",
  2: "Reversible",
  3: "External",
  4: "Financial",
  5: "Sensitive",
};

function ActionCard({
  action,
  onApprove,
  onReject,
}: {
  action: ActionProposal;
  onApprove: () => void;
  onReject: () => void;
}) {
  const danger = action.strong_confirmation;
  return (
    <View style={[styles.card, danger && styles.cardDanger]}>
      <View style={styles.headerRow}>
        <Text style={styles.type}>{action.action_type}</Text>
        <Text style={[styles.risk, danger && styles.riskDanger]}>
          {RISK_LABEL[action.risk_level] ?? `Level ${action.risk_level}`}
        </Text>
      </View>
      {action.reason ? <Text style={styles.reason}>{action.reason}</Text> : null}
      {action.proposed_content ? (
        <Text style={styles.cardContent} numberOfLines={6}>
          {action.proposed_content}
        </Text>
      ) : null}
      {danger ? (
        <Text style={styles.warning}>
          This is irreversible or financial. You will be asked to confirm again.
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable style={styles.reject} onPress={onReject}>
          <Text style={styles.rejectText}>Reject</Text>
        </Pressable>
        <Pressable style={[styles.approve, danger && styles.approveDanger]} onPress={onApprove}>
          <Text style={styles.approveText}>{danger ? "Approve…" : "Approve"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ActionApprovalScreen() {
  const [actions, setActions] = useState<ActionProposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setActions(await api.listPendingActions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load actions");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const approve = useCallback(
    async (action: ActionProposal) => {
      const run = async (confirm: boolean) => {
        try {
          await api.approveAction(action.id, confirm);
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Approval failed");
        }
      };
      if (action.strong_confirmation) {
        Alert.alert(
          "Confirm this action",
          "This is irreversible or moves money. Are you sure?",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Yes, do it", style: "destructive", onPress: () => void run(true) },
          ],
        );
      } else {
        await run(false);
      }
    },
    [load],
  );

  const reject = useCallback(
    async (action: ActionProposal) => {
      await api.rejectAction(action.id);
      await load();
    },
    [load],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Approvals</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {actions.length ? (
        actions.map((a) => (
          <ActionCard
            key={a.id}
            action={a}
            onApprove={() => void approve(a)}
            onReject={() => void reject(a)}
          />
        ))
      ) : (
        <Text style={styles.empty}>Nothing waiting for your approval.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 28, fontWeight: "700" },
  error: { color: "#E5484D", fontSize: 13 },
  empty: { color: colors.textMuted, fontSize: 13, fontStyle: "italic" },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardDanger: { borderColor: "#E5484D" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  type: { color: colors.text, fontSize: 15, fontWeight: "600" },
  risk: { color: colors.textMuted, fontSize: 12 },
  riskDanger: { color: "#E5484D", fontWeight: "700" },
  reason: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  cardContent: {
    color: colors.text,
    fontSize: 13,
    backgroundColor: colors.bg,
    borderRadius: 8,
    padding: spacing.sm,
  },
  warning: { color: "#F5A623", fontSize: 12 },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  reject: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  rejectText: { color: colors.text },
  approve: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  approveDanger: { backgroundColor: "#E5484D" },
  approveText: { color: "#0E0F12", fontWeight: "700" },
});
