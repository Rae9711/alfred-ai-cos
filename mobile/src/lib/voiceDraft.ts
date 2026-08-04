/** Append a speech transcript into the composer, preserving any typed draft. */
export function appendVoiceTranscript(
  current: string,
  transcript: string,
): string {
  const spoken = transcript.trim();
  if (!spoken) return current;
  const existing = current.trimEnd();
  if (!existing) return spoken;
  return `${existing} ${spoken}`;
}
