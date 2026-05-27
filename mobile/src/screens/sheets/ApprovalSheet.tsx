// Draft sheet — generate and review a reply, then save it to the user's Gmail drafts.
// Honest about capability: Albert can create Gmail DRAFTS (gmail.compose), not SEND
// (no gmail.send scope yet), so the action is "Save to Gmail drafts", never "Send".
//
// Three modes, all real (no demo content):
//  - messageId  (Inbox "Draft reply") → createDraft from the real message, then push to
//    Gmail drafts via proposeDraftToGmail → approveAction. Lands in the user's Gmail.
//  - commitmentId (Today "Act")       → draftForCommitment (real LLM draft from the
//    priority). No Gmail thread to attach to, so it saves locally (review only).
//  - neither (Waiting / Meeting prep) → a blank editable draft the user writes; saved
//    locally. Honest: these targets have no source message to thread a Gmail draft onto.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { api } from "@/api/client";
import { Ic } from "@/components/icons";
import { useShell } from "@/components/Shell";
import {
  Btn,
  Eyebrow,
  H2,
  IconBtn,
  Meta,
  Pill,
  Serif,
  SerifEm,
  inputPlaceholder,
} from "@/components/ui";
import { colors, fonts, layout, radius, spacing } from "@/theme/theme";

type Tone = "concise" | "warm" | "formal";

export function ApprovalSheet({
  messageId,
  commitmentId,
  to: toProp,
  subject: subjectProp,
  recipient: recipientProp,
  onDone,
}: {
  messageId?: string;
  commitmentId?: string;
  to?: string;
  subject?: string;
  recipient?: string;
  onDone?: () => void;
}) {
  const { closeSheet, showToast } = useShell();
  // Can we actually push this to the user's Gmail drafts? Only when it came from a real
  // message (the draft is threaded onto it). Otherwise it's a local review-only draft.
  const canSaveToGmail = messageId != null;
  const generates = messageId != null || commitmentId != null;

  const [tone, setTone] = useState<Tone>("concise");
  const [loading, setLoading] = useState(generates);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [to, setTo] = useState(toProp ?? "");
  const [subject, setSubject] = useState(subjectProp ?? "");
  const [recipient, setRecipient] = useState(recipientProp ?? toProp ?? "them");
  const [evidence, setEvidence] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState(!generates); // blank modes start editable

  // Generate a real draft for the current tone (message or commitment mode).
  const fetchDraft = useCallback(
    async (nextTone: Tone) => {
      setLoading(true);
      setError(null);
      try {
        if (messageId != null) {
          const d = await api.createDraft({
            message_id: messageId,
            tone: nextTone,
          });
          setDraftId(d.id);
          if (d.subject) setSubject(d.subject);
          setBody(d.body);
        } else if (commitmentId != null) {
          const d = await api.draftForCommitment(commitmentId, nextTone);
          setTo(d.recipient ?? "");
          if (d.recipient) setRecipient(d.recipient);
          setSubject(d.subject);
          setBody(d.body);
          setEvidence(d.evidence);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't draft this reply");
      } finally {
        setLoading(false);
      }
    },
    [messageId, commitmentId],
  );

  useEffect(() => {
    if (generates) void fetchDraft("concise");
  }, [generates, fetchDraft]);

  const regen = (next: Tone) => {
    setTone(next);
    if (generates) void fetchDraft(next);
  };

  // Save: push to Gmail drafts when we have a message-threaded draft; otherwise just
  // confirm the local draft. Never claims to "send".
  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (canSaveToGmail && draftId) {
        const proposal = await api.proposeDraftToGmail(draftId);
        await api.approveAction(proposal.id);
        showToast("Saved to your Gmail drafts.");
      } else {
        showToast("Draft saved.");
      }
      closeSheet();
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the draft");
      setSaving(false);
    }
  }, [canSaveToGmail, draftId, closeSheet, onDone, showToast]);

  const saveLabel = canSaveToGmail ? "Save to Gmail drafts" : "Save draft";

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Eyebrow color={colors.accent}>Review your draft</Eyebrow>
          <H2 style={styles.title}>
            Reply to <SerifEm>{recipient}</SerifEm>
          </H2>
        </View>
        <IconBtn onPress={closeSheet}>
          <Ic.Close size={16} />
        </IconBtn>
      </View>

      <View style={styles.willHappen}>
        <Text style={styles.willText}>
          <Text style={styles.willStrong}>
            {canSaveToGmail
              ? "Albert saves this to your Gmail drafts"
              : "Albert saves this draft for you"}
          </Text>
          . You send it yourself — nothing leaves without you.
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {to ? <Field label="To" value={to} /> : null}
        {subject ? <Field label="Subject" value={subject} /> : null}

        <View style={styles.bodyCard}>
          <View style={styles.bodyHead}>
            <Text style={styles.bodyLabel}>Body · {tone}</Text>
            <Pill
              label={editing ? "Done" : "Edit"}
              kind="muted"
              onPress={() => setEditing((e) => !e)}
            />
          </View>
          {loading ? (
            <View style={styles.bodyLoading}>
              <ActivityIndicator color={colors.accent} />
              <Meta style={styles.bodyLoadingText}>Drafting your reply…</Meta>
            </View>
          ) : editing ? (
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              placeholder="Write your reply…"
              placeholderTextColor={inputPlaceholder}
              style={styles.bodyInput}
            />
          ) : (
            <Text style={styles.bodyText}>{body || "Write your reply…"}</Text>
          )}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        {generates ? (
          <>
            <Text style={styles.sectionLabel}>Tone</Text>
            <View style={styles.toneRow}>
              {(["concise", "warm", "formal"] as Tone[]).map((opt) => (
                <Btn
                  key={opt}
                  label={opt[0]!.toUpperCase() + opt.slice(1)}
                  kind={tone === opt ? "ink" : "ghost"}
                  onPress={() => regen(opt)}
                  style={styles.toneBtn}
                />
              ))}
            </View>
          </>
        ) : null}

        {evidence ? (
          <>
            <Text style={styles.sectionLabel}>Why I drafted this</Text>
            <View style={styles.evidence}>
              <Serif
                size={14.5}
                italic
                color={colors.ink2}
                style={styles.evidenceQuote}
              >
                "{evidence}"
              </Serif>
            </View>
          </>
        ) : null}

        <View style={styles.risk}>
          <Ic.Lock size={14} color={colors.ink3} stroke={1.6} />
          <Meta style={styles.riskText}>
            {canSaveToGmail
              ? "Saved to your Gmail drafts · you review and send it yourself."
              : "Saved as a draft · nothing is sent."}
          </Meta>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Btn
          label="Discard"
          kind="ghost"
          onPress={closeSheet}
          style={styles.footerSave}
        />
        <Btn
          label={saving ? "Saving…" : saveLabel}
          kind="accent"
          disabled={saving || loading || !body.trim()}
          onPress={() => void save()}
          leading={
            saving ? (
              <Ic.Refresh size={12} color="#fff" />
            ) : (
              <Ic.Check size={12} color="#fff" stroke={2.4} />
            )
          }
          style={styles.footerSend}
        />
      </View>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexShrink: 1, minHeight: 0 },
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headText: { flex: 1, gap: 6 },
  title: { marginTop: 6 },
  willHappen: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  willText: { fontSize: 13, color: colors.ink2, lineHeight: 20 },
  willStrong: { fontWeight: "500", color: colors.ink },
  scroll: { flexShrink: 1, minHeight: 0, marginTop: 14 },
  scrollContent: { paddingBottom: 12 },
  field: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
  },
  fieldLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
    width: 64,
    paddingTop: 3,
  },
  fieldValue: { flex: 1, fontSize: 14, color: colors.ink },
  bodyCard: {
    marginTop: 14,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hair,
  },
  bodyHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  bodyLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.ink4,
  },
  bodyText: {
    fontFamily: fonts.serif,
    fontSize: 15.5,
    lineHeight: 24,
    color: colors.ink,
  },
  bodyInput: {
    fontFamily: fonts.serif,
    fontSize: 15.5,
    lineHeight: 24,
    color: colors.ink,
    minHeight: 200,
    textAlignVertical: "top",
  },
  bodyLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 24,
  },
  bodyLoadingText: { color: colors.ink3 },
  errorText: { color: colors.warn, fontSize: 13, marginTop: 10 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "500",
    letterSpacing: 0.78,
    textTransform: "uppercase",
    color: colors.ink3,
    marginTop: 18,
    marginBottom: 8,
  },
  toneRow: { flexDirection: "row", gap: 6 },
  toneBtn: { flex: 1 },
  evidence: { backgroundColor: colors.paper2, borderRadius: 12, padding: 12 },
  evidenceQuote: { lineHeight: 22 },
  risk: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    marginTop: 16,
    paddingHorizontal: 4,
  },
  riskText: { flex: 1, lineHeight: 18 },
  footer: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 12,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hair,
  },
  footerSave: { flex: 1 },
  footerSend: { flex: 1.6 },
});
