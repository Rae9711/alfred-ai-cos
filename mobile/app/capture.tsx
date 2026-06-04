// Full-screen capture route, presented over the tabs (the prototype's center "+").
// Closes back to Today; CaptureScreen reloads the dashboard on confirm.
//
// Accepts ?text=... so an iOS Shortcut can dictate → open `albert://capture?text=...`
// → the screen auto-submits the captured text without the user typing.

import { useLocalSearchParams, useRouter } from "expo-router";

import { CaptureScreen } from "@/screens/CaptureScreen";

export default function Capture() {
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string }>();
  const initialText = typeof params.text === "string" ? params.text : undefined;
  return (
    <CaptureScreen onClose={() => router.back()} initialText={initialText} />
  );
}
