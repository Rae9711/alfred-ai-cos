// On-device speech recognition when the native module is linked (new builds).
// Older preview binaries (runtime 0.1.0 without expo-speech-recognition) must
// not import the package at module scope — requireNativeModule throws and
// crashes the app. We lazy-require and degrade to a clear error instead.

import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { CaptureResponse } from "@albert/shared-types";

import { api } from "@/api/client";

export type VoiceState = "idle" | "recording" | "uploading";

type SpeechModule = typeof import("expo-speech-recognition");

let cachedSpeech: SpeechModule | null | undefined;

function loadSpeechModule(): SpeechModule | null {
  if (cachedSpeech !== undefined) return cachedSpeech;
  try {
    // Dynamic require so missing native code does not crash app startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedSpeech = require("expo-speech-recognition") as SpeechModule;
  } catch {
    cachedSpeech = null;
  }
  return cachedSpeech;
}

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

const NEED_BUILD_MSG =
  "Voice needs the latest Alfred build — reinstall from the install link, then try again.";

function useOnDeviceSpeech(onTranscript: (text: string) => Promise<void>) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<VoiceState>("idle");
  const transcriptRef = useRef("");
  const pendingStop = useRef<{
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  } | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  stateRef.current = state;

  useEffect(() => {
    const speech = loadSpeechModule();
    if (!speech) return;

    const mod = speech.ExpoSpeechRecognitionModule;
    const subResult = mod.addListener("result", (event) => {
      const top = event.results?.[0]?.transcript?.trim();
      if (top) transcriptRef.current = top;
    });
    const subError = mod.addListener("error", (event) => {
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
    const subEnd = mod.addListener("end", () => {
      if (pendingStop.current) {
        const { resolve } = pendingStop.current;
        pendingStop.current = null;
        resolve(transcriptRef.current);
      }
    });

    return () => {
      subResult.remove();
      subError.remove();
      subEnd.remove();
      try {
        mod.abort();
      } catch {
        // ignore
      }
    };
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current !== "idle") return;
    setError(null);
    transcriptRef.current = "";

    const speech = loadSpeechModule();
    if (!speech) {
      setError(NEED_BUILD_MSG);
      return;
    }

    try {
      const result = await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        setError("Microphone permission is required for voice input.");
        return;
      }
      if (!speech.ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        setError("Speech recognition is not available on this device.");
        return;
      }
      const preferOnDevice =
        Platform.OS === "ios" &&
        speech.ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
      speech.ExpoSpeechRecognitionModule.start({
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
        /native module|ExpoSpeechRecognition/i.test(msg) ? NEED_BUILD_MSG : msg,
      );
    }
  }, []);

  const stop = useCallback(async () => {
    if (stateRef.current !== "recording") return;
    setState("uploading");
    const speech = loadSpeechModule();
    try {
      if (!speech) {
        throw new Error(NEED_BUILD_MSG);
      }
      const text = await new Promise<string>((resolve, reject) => {
        pendingStop.current = { resolve, reject };
        try {
          speech.ExpoSpeechRecognitionModule.stop();
        } catch (e) {
          pendingStop.current = null;
          reject(e instanceof Error ? e : new Error("Could not stop recording"));
          return;
        }
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
      await onTranscriptRef.current(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice capture failed");
    } finally {
      setState("idle");
    }
  }, []);

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
