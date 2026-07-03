import { describe, expect, it } from "bun:test";

import { normalizeSmsBody } from "@/lib/smsBody";

describe("normalizeSmsBody", () => {
  it("extracts text from stringified shortcut JSON", () => {
    const raw =
      '{"body":"Ray, what did you dream about?","text":"Ray, what did you dream about?","shortcut_input":"Ray, what did you dream about?"}';
    expect(normalizeSmsBody(raw)).toBe("Ray, what did you dream about?");
  });

  it("leaves plain text unchanged", () => {
    expect(normalizeSmsBody("Hello")).toBe("Hello");
  });
});
