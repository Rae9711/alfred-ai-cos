# Alfred Keyboard Extension

Custom iOS keyboard that turns a WeChat multi-select paste into reply suggestions
and confirmed actions (task / calendar / follow-up).

## Requirements

- Custom/dev client build (not Expo Go) — run `npx expo prebuild --platform ios`
  then open `ios/` in Xcode, or build with EAS (`eas build --profile preview`).
- App Group `group.com.haoruiwang.alfred` on both the app and the keyboard target.
- Keyboard **Full Access** enabled (Settings → General → Keyboard → Alfred → Allow Full Access)
  so the extension can read the clipboard and call the Alfred API.
- User signed in to the main Alfred app (session token is mirrored into the App Group).

## Wiring the keyboard target in Xcode (first prebuild)

The config plugin (`plugins/withAlfredKeyboard.js`) copies sources into
`ios/AlfredKeyboard/` and stamps App Group entitlements on the main app. On the
first prebuild, finish wiring the extension target in Xcode if it is not already
linked:

1. File → New → Target → Custom Keyboard Extension → name `AlfredKeyboard`
2. Replace generated sources with the files under `targets/AlfredKeyboard/`
3. Set bundle id `com.haoruiwang.alfred.AlfredKeyboard`
4. Add App Group + Keychain access group entitlements (same as main app shared group)
5. Embed the extension in the Alfred app target

## Flow

1. User multi-selects WeChat messages → Copy
2. Switch to Alfred Keyboard → tap **导入对话**
3. Extension calls `POST /conversations/parse` then `/analyze`
4. User inserts a reply via `textDocumentProxy.insertText`
5. User confirms an action → `POST /conversations/actions/confirm` + enqueue into App Group
6. Main app drains App Group on foreground and schedules a local notification **only**
   if the confirmed action has `remind_at`
