// Capture screen (PRD 10.3). For A5 this is a manual task quick-add plus the task
// list. A6 adds AI parsing of messy free text into structured tasks.

import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { TaskStatus, type Task } from "@albert/shared-types";

import { api } from "@/api/client";
import { colors, priorityColor, spacing } from "@/theme/theme";

export function CaptureScreen() {
  const [title, setTitle] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks(await api.listTasks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tasks");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle("");
    try {
      await api.createTask({ title: trimmed });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add task");
    }
  }, [title, load]);

  const toggle = useCallback(
    async (task: Task) => {
      const next =
        task.status === TaskStatus.Done ? TaskStatus.Open : TaskStatus.Done;
      await api.updateTaskStatus(task.id, next);
      await load();
    },
    [load],
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Capture</Text>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Add a task…"
          placeholderTextColor={colors.textMuted}
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={() => void add()}
          returnKeyType="done"
        />
        <Pressable style={styles.addButton} onPress={() => void add()}>
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Tasks</Text>
      {tasks.length ? (
        tasks.map((t) => (
          <Pressable
            key={t.id}
            style={styles.task}
            onPress={() => void toggle(t)}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: priorityColor[t.priority] },
              ]}
            />
            <Text
              style={[
                styles.taskTitle,
                t.status === TaskStatus.Done && styles.done,
              ]}
            >
              {t.title}
            </Text>
            {t.due_date ? <Text style={styles.due}>{t.due_date}</Text> : null}
          </Pressable>
        ))
      ) : (
        <Text style={styles.empty}>No tasks yet. Add one above.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  heading: { color: colors.text, fontSize: 28, fontWeight: "700" },
  inputRow: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
  },
  addButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  addText: { color: "#0E0F12", fontWeight: "700" },
  error: { color: "#E5484D", fontSize: 13 },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  empty: { color: colors.textMuted, fontSize: 13, fontStyle: "italic" },
  task: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { color: colors.text, fontSize: 15, flex: 1 },
  done: { textDecorationLine: "line-through", color: colors.textMuted },
  due: { color: colors.textMuted, fontSize: 12 },
});
