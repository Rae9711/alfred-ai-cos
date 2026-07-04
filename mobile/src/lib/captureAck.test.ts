import { describe, expect, it } from "vitest";
import type { CaptureResponse } from "@albert/shared-types";

import { translations } from "@/i18n/locales";

import { buildCaptureAcknowledgment } from "./captureAck";

const t = translations.en.capture;

function result(partial: Partial<CaptureResponse> & Pick<CaptureResponse, "tasks">) {
  return {
    detected_project: null,
    ...partial,
  } satisfies CaptureResponse;
}

describe("buildCaptureAcknowledgment", () => {
  it("returns the empty ack when nothing was extracted", () => {
    expect(buildCaptureAcknowledgment(result({ tasks: [] }), t)).toBe(
      t.ackNothing,
    );
  });

  it("names a single task", () => {
    expect(
      buildCaptureAcknowledgment(
        result({ tasks: [{ id: "1", title: "Email Daniel the A3 PDF" } as never] }),
        t,
      ),
    ).toContain("Email Daniel the A3 PDF");
  });

  it("mentions a due date when present", () => {
    const ack = buildCaptureAcknowledgment(
      result({
        tasks: [
          {
            id: "1",
            title: "Book the United flight",
            due_date: "2026-07-05",
          } as never,
        ],
      }),
      t,
    );
    expect(ack).toContain("Book the United flight");
    expect(ack).toContain("2026-07-05");
  });

  it("mentions a reminder time when present", () => {
    const ack = buildCaptureAcknowledgment(
      result({
        tasks: [
          {
            id: "1",
            title: "Call the broker",
            remind_at: "tomorrow at 9am",
          } as never,
        ],
      }),
      t,
    );
    expect(ack).toContain("Call the broker");
    expect(ack).toContain("tomorrow at 9am");
  });

  it("names the detected project for a single task", () => {
    const ack = buildCaptureAcknowledgment(
      result({
        detected_project: "Factory Sale",
        tasks: [{ id: "1", title: "Review valuation" } as never],
      }),
      t,
    );
    expect(ack).toContain("Factory Sale");
    expect(ack).toContain("Review valuation");
  });

  it("summarizes multiple tasks from the first title", () => {
    const ack = buildCaptureAcknowledgment(
      result({
        tasks: [
          { id: "1", title: "Call the broker" } as never,
          { id: "2", title: "Draft the offer" } as never,
        ],
      }),
      t,
    );
    expect(ack).toContain("Call the broker");
    expect(ack).toMatch(/two things|2 things/i);
  });
});
