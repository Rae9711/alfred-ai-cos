// On-device speech recognition (iOS SFSpeechRecognizer / Android SpeechRecognizer).
// Audio never leaves the device for Alfred's servers — only the transcript text is
// sent to the API (captureText for tasks, or a local callback for dictation).

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { CaptureResponse } from "@albert/shared-types";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

import { api } from "@/api/client";

export type VoiceState = "idle" | "recording" | "uploading";

function speechLang(): string {
  try {
    const loc = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
    if (loc.toLowerCase().startsWith("zh")) return "zh-CN";
    if (loc.includes("-")) return loc;
    if (loc === "en") return "en-US";
    return loc;
  } catch {
    return "en-US";
  }
}

async function ensureSpeechReady(): Promise<string | null> {
  try {
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!result.granted) {
      return "Microphone permission is required for voice input.";
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      return "Speech recognition is not available on this device.";
    }
  } catch {
    // Native module missing (old binary before expo-speech-recognition was linked).
    return "Voice needs the latest Alfred build — reinstall from TestFlight, then try again.";
  }
  return null;
}

function useOnDeviceSpeech(onTranscript: (text: string) => Promise<void>) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<VoiceState>("idle");
  const transcriptRef = useRef("");
  const pendingStop = useRef<{
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  } | null>(null);
  stateRef.current = state;

  useSpeechRecognitionEvent("result", (event) => {
    const top = event.results[0]?.transcript?.trim();
    if (top) transcriptRef.current = top;
  });

  useSpeechRecognitionEvent("error", (event) => {
    // "aborted" / "no-speech" while stopping is benign.
    const code = String(event.error ?? "");
    if (code === "aborted" || code === "no-speech") {
      if (pendingStop.current) {
        const { resolve } = pendingStop.current;
        pendingStop.current = null;
        resolve(transcriptRef.current);
      }
      return;
    }
    if (pendingStop.current) {
      const { reject } = pendingStop.current;
      pendingStop.current = null;
      reject(new Error(event.message || code || "Speech recognition failed"));
      return;
    }
    setState("idle");
    setError(event.message || code || "Speech recognition failed");
  });

  useSpeechRecognitionEvent("end", () => {
    if (pendingStop.current) {
      const { resolve } = pendingStop.current;
      pendingStop.current = null;
      resolve(transcriptRef.current);
    }
  });

  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // ignore teardown errors
      }
    };
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    setError(null);
    transcriptRef.current = "";
    try {
      const permError = await ensureSpeechReady();
      if (permError) {
        setError(permError);
        return;
      }
      const preferOnDevice =
        Platform.OS === "ios" &&
        (() => {
          try {
            return ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
          } catch {
            return false;
          }
        })();
      ExpoSpeechRecognitionModule.start({
        lang: speechLang(),
        interimResults: true,
        continuous: false,
        requiresOnDeviceRecognition: preferOnDevice,
        addsPunctuation: true,
      });
      setState("recording");
    } catch (e) {
      setState("idle");
      const msg = e instanceof Error ? e.message : "Could not start recording";
      setError(
        /native module|expo-speech-recognition/i.test(msg)
          ? "Voice needs the latest Alfred build — reinstall from TestFlight, then try again."
          : msg,
      );
    }
  }, []);

  const stop = useCallback(async () => {
    if (stateRef.current !== "recording") return;
    setState("uploading");
    try {
      const text = await new Promise<string>((resolve, reject) => {
        pendingStop.current = { resolve, reject };
        try {
          ExpoSpeechRecognitionModule.stop();
        } catch (e) {
          pendingStop.current = null;
          reject(e instanceof Error ? e : new Error("Could not stop recording"));
          return;
        }
        // If the native stack never fires end/result, don't hang forever.
        setTimeout(() => {
          if (pendingStop.current) {
            const { resolve: done } = pendingStop.current;
            pendingStop.current = null;
            done(transcriptRef.current);
          }
        }, 2500);
      });
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error("No speech detected — try again.");
      }
      await onTranscript(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice capture failed");
    } finally {
      setState("idle");
    }
  }, [onTranscript]);

  const clearError = useCallback(() => setError(null), []);

  return { state, error, start, stop, clearError };
}

/** Task capture: on-device STT → POST /capture (Anthropic parses tasks). */
export function useVoiceCapture(onResult: (r: CaptureResponse) => void) {
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const handle = useCallback(async (transcript: string) => {
    onResultRef.current(await api.captureText(transcript));
  }, []);

  return useOnDeviceSpeech(handle);
}

/** Composer dictation: on-device STT → transcript only (no task creation). */
export function useVoiceDictation(onTranscript: (text: string) => void) {
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const handle = useCallback(async (transcript: string) => {
    onTranscriptRef.current(transcript);
  }, []);

  return useOnDeviceSpeech(handle);
}
