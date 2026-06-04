// Unified search screen: hits across messages and commitments. The query
// box lives at the top; results are rendered as a flat list with a small kind
// chip so the user knows what they're tapping.

import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { api } from "@/api/client";
import { Ic } from "@/components/icons";
import { Eyebrow, IconBtn, Meta, Pill, Serif } from "@/components/ui";
import { colors, fonts, spacing } from "@/theme/theme";

type Hit = {
  kind: "message" | "commitment";
  id: string;
  title: string;
  snippet: string;
  sender: string | null;
  when: string | null;
  score: number;
};

export default function SearchScreen() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce so each keystroke doesn't burn a request.
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setHits([]);
      setError(null);
      return;
    }
    debounce.current = setTimeout(async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await api.search(q.trim());
        setHits(result.results);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setBusy(false);
      }
    }, 220);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [q]);

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <IconBtn onPress={() => router.back()}>
          <Ic.Close size={16} />
        </IconBtn>
        <Eyebrow style={styles.eyebrow}>Search</Eyebrow>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.searchBox}>
        <Ic.Search size={16} color={colors.ink3} />
        <TextInput
          style={styles.input}
          placeholder="Search messages and commitments…"
          placeholderTextColor={colors.ink4}
          value={q}
          onChangeText={setQ}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {q.length > 0 ? (
          <Pressable onPress={() => setQ("")} hitSlop={8}>
            <Ic.Close size={14} color={colors.ink3} />
          </Pressable>
        ) : null}
      </View>

      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      >
        {hits.length === 0 && q.length >= 2 && !busy ? (
          <Text style={styles.empty}>
            No hits. Try fewer or different words.
          </Text>
        ) : null}
        {hits.map((h) => (
          <HitRow key={`${h.kind}:${h.id}`} hit={h} />
        ))}
      </ScrollView>
    </View>
  );
}

function HitRow({ hit }: { hit: Hit }) {
  const when = hit.when ? new Date(hit.when) : null;
  const whenLabel =
    when && !Number.isNaN(when.getTime())
      ? when.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : "";
  return (
    <View style={styles.hit}>
      <View style={styles.hitHead}>
        <Pill
          label={hit.kind === "message" ? "email" : "task"}
          kind={hit.kind === "message" ? "accent" : "warn"}
        />
        {hit.sender ? <Meta>{hit.sender.split(" ")[0]}</Meta> : null}
        {whenLabel ? <Meta>{whenLabel}</Meta> : null}
      </View>
      <Serif size={16} style={styles.hitTitle}>
        {hit.title}
      </Serif>
      {hit.snippet ? (
        <Text style={styles.hitSnippet} numberOfLines={2}>
          {hit.snippet}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.paper, paddingTop: 52 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  eyebrow: { flex: 1, textAlign: "center" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.paper2,
    borderRadius: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: 0,
  },
  busy: { paddingVertical: 30, alignItems: "center" },
  error: {
    color: colors.warn,
    fontSize: 13,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  empty: {
    color: colors.ink3,
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 40,
  },
  list: { flex: 1, marginTop: spacing.md },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: 80 },
  hit: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hair,
    gap: 6,
  },
  hitHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  hitTitle: { marginTop: 2 },
  hitSnippet: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink3,
    lineHeight: 17,
  },
});
