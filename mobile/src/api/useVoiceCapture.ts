// Voice capture hook. Records an audio note with expo-audio and uploads it to the
// voice capture endpoint. Handles the "voice not configured" (501) case gracefully.

import { useCallback, useState } from "react";
import { AudioModule, RecordingPresets, useAudioRecorder } from "expo-audio";
import type { CaptureResponse } from "@albert/shared-types";

import { api } from "@/api/client";

type State = "idle" | "recording" | "uploading";

export function useVoiceCapture(onResult: (r: CaptureResponse) => void) {
  // HIGH_QUALITY is a built-in preset, always present at runtime. The non-null
  // assertion satisfies noUncheckedIndexedAccess on the presets record.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY!);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setError(null);
    const granted = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted.granted) {
      setError("Microphone permission is required for voice capture.");
      return;
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
    setState("recording");
  }, [recorder]);

  const stop = useCallback(async () => {
    setState("uploading");
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("No recording produced");
      onResult(await api.captureVoice(uri));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice capture failed");
    } finally {
      setState("idle");
    }
  }, [recorder, onResult]);

  return { state, error, start, stop };
}
