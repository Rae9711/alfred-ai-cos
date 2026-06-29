/** JSON body for POST /api/v1/inbox/sms — matches iOS Shortcut Dictionary keys. */

export type SmsForwardPayload = {
  body: string;
  text: string;
  shortcut_input: string;
  backfill?: boolean;
  from_number?: string;
};

export function buildSmsForwardPayload(
  text: string,
  opts?: { backfill?: boolean; fromNumber?: string },
): SmsForwardPayload {
  const trimmed = text.trim();
  const payload: SmsForwardPayload = {
    body: trimmed,
    text: trimmed,
    shortcut_input: trimmed,
  };
  if (opts?.backfill) payload.backfill = true;
  if (opts?.fromNumber?.trim()) payload.from_number = opts.fromNumber.trim();
  return payload;
}
