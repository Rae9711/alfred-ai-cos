import { afterEach, describe, expect, it, vi } from "vitest";

describe("resolveApiBaseUrl", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock("expo-constants");
    vi.doUnmock("react-native");
  });

  it("never falls back to localhost on native when extra is missing", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "");
    vi.stubGlobal("__DEV__", false);
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.doMock("expo-constants", () => ({
      default: { expoConfig: { extra: {} }, manifest2: null },
    }));
    const { resolveApiBaseUrl, PRODUCTION_API_BASE_URL } = await import(
      "./apiBaseUrl"
    );
    expect(resolveApiBaseUrl()).toBe(PRODUCTION_API_BASE_URL);
  });

  it("prefers EXPO_PUBLIC_API_BASE_URL", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_BASE_URL", "https://api.example.com/");
    vi.stubGlobal("__DEV__", false);
    vi.doMock("react-native", () => ({ Platform: { OS: "ios" } }));
    vi.doMock("expo-constants", () => ({
      default: {
        expoConfig: { extra: { apiBaseUrl: "https://ignored.example" } },
        manifest2: null,
      },
    }));
    const { resolveApiBaseUrl } = await import("./apiBaseUrl");
    expect(resolveApiBaseUrl()).toBe("https://api.example.com");
  });
});
