# Capture with Siri / lock-screen / control-center

This is the one-tap dictation flow.

Hold-to-talk on the lock screen → say "Hey Siri, capture for Albert" → speak →
the note lands in Albert. Two taps total from a locked phone.

## Building the Shortcut (one-time, ~2 minutes)

1. Open the **Shortcuts** app on iOS.
2. Tap **+** to create a new Shortcut.
3. Add action: **Dictate Text**.
   - Language: matches your usual capture language.
   - Stop Listening: After Pause (recommended) so you can ramble.
4. Add action: **URL**.
   - Set the URL to `albert://capture?text=` then tap into the field, hit the
     little "Magic Variable" picker, and insert **Dictated Text**.
   - The resulting URL field reads: `albert://capture?text=[Dictated Text]`.
5. Add action: **Open URLs**.
   - Make sure it points at the URL action from step 4.
6. Tap the Shortcut name at the top (default "Untitled Shortcut") and rename
   it to **Capture for Albert**.
7. Bottom-right share icon → **Add to Home Screen** if you want a one-tap
   tile. Or skip — Siri can invoke it by name.

## Triggers, in order of usefulness

| Trigger        | How                                                                         |
| -------------- | --------------------------------------------------------------------------- |
| Siri           | "Hey Siri, capture for Albert" — works from the lock screen, hands-free.    |
| Lock screen    | Add Shortcut to the Lock Screen (Customize → Lock Screen → bottom widgets). |
| Control Center | Settings → Control Center → add Shortcuts → pick "Capture for Albert".      |
| Home Screen    | Add to Home Screen from step 7 above.                                       |
| Apple Watch    | Add the Shortcut as a Watch complication; tap from any watch face.          |

## What happens after dictation

The Shortcut opens `albert://capture?text=<dictated>`. Albert's capture screen
receives the text, switches to type mode, and auto-submits to the backend
(`POST /api/v1/capture`). The backend parses commitments + tasks the same way
it parses any text capture; results land in Today.

You'll briefly see Albert open and the parsed-result screen show your tasks.
Dismiss to return to whatever you were doing.

## Troubleshooting

- "Shortcut couldn't open URL" → make sure Albert is installed on this device
  and the URL scheme `albert://` is registered (it is, in production builds).
- Dictation accuracy: Siri's dictation is the bottleneck, not Albert's parser.
  Speak in short complete sentences.
- Nothing shows up in Today: pull-to-refresh the Today screen; the capture
  endpoint creates tasks, not commitments, so they appear in the Quick wins
  row.
