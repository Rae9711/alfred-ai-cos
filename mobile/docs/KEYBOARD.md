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

## Build (cloud / CI-friendly)

```bash
cd mobile
bun run prebuild:ios          # expo prebuild + wire-alfred-keyboard.cjs
# On a Mac with Xcode: open ios/*.xcworkspace, confirm Embed App Extensions,
# App Groups on both targets, then:
bun run device:ios            # or: eas build --profile preview --platform ios
```

`scripts/wire-alfred-keyboard.cjs` attaches Swift sources, `AlfredKeyboard-Info.plist`,
and entitlements to the extension target created during prebuild.

After JS-only changes to the main app (not native keyboard code):

```bash
bun run update:preview -- "WeChat import polish"
```

Keyboard Swift / entitlements / target changes **require a new native build**, not OTA.

## Wiring the keyboard target in Xcode (first prebuild)

The config plugin (`plugins/withAlfredKeyboard.js`) copies sources into
`ios/AlfredKeyboard/`, stamps App Group entitlements on the main app, and writes
`ios/AlfredKeyboard/.alfred-keyboard-target`. On the first prebuild, finish wiring
the extension target in Xcode if it is not already linked:

1. File → New → Target → Custom Keyboard Extension → name `AlfredKeyboard`
2. Replace generated sources with the files under `targets/AlfredKeyboard/`
   (or point the target at `ios/AlfredKeyboard/` created by prebuild)
3. Set bundle id `com.haoruiwang.alfred.AlfredKeyboard`
4. Add App Group + Keychain access group entitlements (same as main app shared group)
5. Embed the extension in the Alfred app target
6. Confirm `RequestsOpenAccess = true` in the keyboard `Info.plist` (already in tree)

Checklist after install on device:

- [ ] Settings → General → Keyboard → Keyboards → Add New Keyboard → **Alfred**
- [ ] Alfred → **Allow Full Access**
- [ ] Open Alfred app once while signed in (mirrors JWT into App Group)
- [ ] In any text field, switch to Alfred keyboard → status should not say「请开启完全访问」

## Full Access / memory guidance (product copy)

| Situation | What the keyboard shows |
|---|---|
| Full Access off | `请开启完全访问：设置 → 通用 → 键盘 → Alfred` |
| Not signed in | `请先在 Alfred App 登录（会话会同步到键盘）` |
| Empty clipboard | `复制微信多选消息后点「导入对话」` |
| After confirm w/ reminder | `已加入 Alfred · 回 App 后会设本地提醒` |

iOS may terminate keyboards under memory pressure — keep the UI to ~3 actions + 3 replies
(current `KeyboardViewController` already caps actions with `.prefix(3)`).

## Flow

1. User multi-selects WeChat messages → Copy
2. Switch to Alfred Keyboard → tap **导入对话**
3. Extension calls `POST /conversations/parse` then `/analyze`
4. User inserts a reply via `textDocumentProxy.insertText`
5. User confirms an action → `POST /conversations/actions/confirm` + enqueue into App Group
6. Main app drains App Group on foreground and schedules a local notification **only**
   if the confirmed action has `remind_at`

## In-app alternative (no keyboard build)

Home → **从对话中发现** / route `/import` → clipboard paste → same parse/analyze/confirm
API. Works after an OTA that includes `ImportConversationScreen`; does not need Full Access.
