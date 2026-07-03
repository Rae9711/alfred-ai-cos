import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/contacts", () => ({
  loadContactNamesByPhone: vi.fn(async () => new Map([["5551234567", "Mickey Wilkinson"]])),
}));

vi.mock("@/lib/smsBody", () => ({
  normalizeSmsBody: (raw: string | null | undefined) => {
    const text = (raw ?? "").trim();
    if (!text.startsWith("{")) return text;
    try {
      const parsed = JSON.parse(text) as { body?: string; text?: string };
      return parsed.body || parsed.text || text;
    } catch {
      return text;
    }
  },
}));

import { enrichSmsDetailFields, mergeSmsSenderDisplay, resolveSmsSenderDisplay } from "./smsSenderDisplay";

describe("smsSenderDisplay", () => {
  it("resolves unknown sender from reply phone", () => {
    const names = new Map([["5551234567", "Mickey Wilkinson"]]);
    expect(
      resolveSmsSenderDisplay("Unknown sender", "+15551234567", names),
    ).toBe("Mickey Wilkinson");
  });

  it("keeps enriched sender when API still says unknown", () => {
    expect(mergeSmsSenderDisplay("Mickey Wilkinson", "Unknown sender")).toBe(
      "Mickey Wilkinson",
    );
  });

  it("unwraps JSON SMS body in detail fields", async () => {
    const raw =
      '{"body":"Ray, what did you dream about?","text":"Ray, what did you dream about?","shortcut_input":"Ray, what did you dream about?"}';
    const enriched = await enrichSmsDetailFields({
      sender: "Unknown sender",
      snippet: raw,
      body: raw,
      source: "sms",
      reply_phone: "+15551234567",
    });
    expect(enriched.body).toBe("Ray, what did you dream about?");
    expect(enriched.sender).toBe("Mickey Wilkinson");
  });
});
