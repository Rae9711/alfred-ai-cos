// Action approval sheet — sending an email on the user's behalf. Pixel-matched to
// the prototype's ScreenApproval: "ready to send" eyebrow, what-will-happen banner,
// To/Subject/Attached fields, editable body, tone selector (concise/warm/formal),
// evidence quote, risk note, Save/Send footer.
//
// When opened from a real draft (a DraftCreateRequest result) it uses that; from the
// Inbox demo it falls back to the scripted Khalil draft. Tone switching uses the
// scripted variants until the backend supports tone-aware regeneration.

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
import { DEMO_DRAFT, TONE_VARIANTS } from "@/data/demo";
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

// Two modes:
//  - commitmentId present (Today "Act") → fetch a REAL draft from the backend; tone
//    change re-drafts. To/subject/body/evidence all come from the commitment.
//  - no commitmentId (Inbox demo) → scripted DEMO_DRAFT content, as before.
export function ApprovalSheet({
  commitmentId,
  to: toProp,
  subject: subjectProp,
  recipient: recipientProp = "Prof. Khalil",
  initialBody,
  onDone,
}: {
  commitmentId?: string;
  to?: string;
  subject?: string;
  recipient?: string;
  initialBody?: string;
  onDone?: () => void;
}) {
  const { closeSheet } = useShell();
  const real = commitmentId != null;

  const [tone, setTone] = useState<Tone>("concise");
  const [loading, setLoading] = useState(real);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState(toProp ?? (real ? "" : DEMO_DRAFT.to));
  const [subject, setSubject] = useState(
    subjectProp ?? (real ? "" : DEMO_DRAFT.subject),
  );
  const [recipient, setRecipient] = useState(recipientProp);
  const [evidence, setEvidence] = useState<string | null>(
    real ? null : DEMO_DRAFT.evidence,
  );
  const [body, setBody] = useState(
    initialBody ?? (real ? "" : (TONE_VARIANTS.concise ?? "")),
  );
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);

  // Fetch a real draft for a commitment (and on tone change).
  const fetchDraft = useCallback(
    async (nextTone: Tone) => {
      if (!commitmentId) return;
      setLoading(true);
      setError(null);
      try {
        const d = await api.draftForCommitment(commitmentId, nextTone);
        setTo(d.recipient ?? "");
        setSubject(d.subject);
        if (d.recipient) setRecipient(d.recipient);
        setBody(d.body);
        setEvidence(d.evidence);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't draft this reply");
      } finally {
        setLoading(false);
      }
    },
    [commitmentId],
  );

  useEffect(() => {
    if (real) void fetchDraft("concise");
  }, [real, fetchDraft]);

  const regen = (next: Tone) => {
    setTone(next);
    if (real) void fetchDraft(next);
    else setBody(TONE_VARIANTS[next] ?? body);
  };

  const send = () => {
    setSending(true);
    setTimeout(() => {
      setSending(false);
      closeSheet();
      onDone?.();
    }, 600);
  };

  const firstName = recipient.split(" ").slice(-1)[0] ?? recipient;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Eyebrow color={colors.accent}>Ready to send · approve below</Eyebrow>
          <H2 style={styles.title}>
            Email to <SerifEm>{recipient}</SerifEm>
          </H2>
        </View>
        <IconBtn onPress={closeSheet}>
          <Ic.Close size={16} />
        </IconBtn>
      </View>

      <View style={styles.willHappen}>
        <Text style={styles.willText}>
          <Text style={styles.willStrong}>Albert will send</Text> this from your
          Gmail account — reversible within 30 seconds.
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Field label="To" value={to || "—"} />
        <Field label="Subject" value={subject || "—"} />
        {real ? null : (
          <Field
            label="Attached"
            value={DEMO_DRAFT.attachments.join(", ") || "—"}
          />
        )}

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
            Reversible action · Logged in your activity history · Albert will
            not send before you press Send.
          </Meta>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Btn
          label="Save draft"
          kind="ghost"
          onPress={closeSheet}
          style={styles.footerSave}
        />
        <Btn
          label={sending ? "Sending…" : `Send to ${firstName}`}
          kind="accent"
          disabled={sending || loading || !body.trim()}
          onPress={send}
          leading={
            sending ? (
              <Ic.Refresh size={12} color="#fff" />
            ) : (
              <Ic.Send size={12} color="#fff" />
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
  // Fill the sheet so the middle ScrollView can flex between the fixed header and
  // footer; without this the content overflows the capped sheet and the bottom
  // (evidence + footer) gets clipped with nothing to scroll.
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
