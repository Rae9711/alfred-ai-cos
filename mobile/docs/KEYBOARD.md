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
- [ ] You → **键盘诊断** → confirm App Group 可访问 + Auth Token 已写入
- [ ] Tap **同步键盘登录状态** if token is missing
- [ ] In any text field, switch to Alfred keyboard → should not show「需要允许完全访问」

## Diagnostics (main app)

You → **键盘诊断** (`/keyboard-diagnostics`) shows real status:

| Row | Values |
|---|---|
| Keyboard Extension | Best-effort via last-seen marker; otherwise honest「无法从主 App 检测…」 |
| App Group | 可访问 / 不可访问 |
| Auth Token | 已写入 / 未写入 |
| Token Updated | timestamp or — |
| Full Access | Guidance only — main app cannot read FA;「请在系统设置中开启」 |

**同步键盘登录状态** calls `syncAuthToAppGroup` and refreshes the panel.

App Group suite must never silently fall back to `UserDefaults.standard` — suite failure surfaces as「未发现共享容器」in the keyboard.

## Keyboard error copy

| Condition | Message |
|---|---|
| `!hasFullAccess` | 需要允许完全访问 |
| App Group suite unavailable | 未发现共享容器 |
| Full Access on, container OK, no token | 主 App 尚未同步 |
| API 401 / expired | 登录已过期 |
| Network failure | 网络不可用 |

## State machine UI (~320pt)

```
IDLE → IMPORTING → CONTEXT_REVIEW → GENERATING → REPLY_READY → EDITING
```

- **IDLE:** 「复制微信聊天后，点击导入」+ [导入所选消息]
- **IMPORTING / GENERATING:** loading
- **CONTEXT_REVIEW:** counts + [查看上下文] [继续]
- **REPLY_READY:** insight, one primary reply, [换一个] [编辑] [插入], action summary, [查看并确认], **展开 ↗**
- **EDITING:** TextView + [更简短] [更温柔] [更直接] + [插入回复]

Bottom chrome: 🌐 next keyboard, space / backspace / return (no full QWERTY).

**展开 ↗** opens `albert://conversation/{conversationId}` (scheme from `app.json`), writing parse/analyze session into App Group handoff so Import can hydrate.

## Deep link

- Scheme: `albert` (not `alfred`)
- `albert://conversation/{id}` → `/conversation/[id]` → `ImportConversationScreen` with handoff
- Confirm actions: `POST /conversations/actions/confirm` + App Group drain for reminders

## Flow

1. User multi-selects WeChat messages → Copy
2. Switch to Alfred Keyboard → tap **导入所选消息**
3. Extension calls `POST /conversations/parse` → context review → `/analyze`
4. User inserts a reply via `textDocumentProxy.insertText` (only on 插入)
5. User confirms an action → `POST /conversations/actions/confirm` + enqueue into App Group
6. Main app drains App Group on foreground and schedules a local notification **only**
   if the confirmed action has `remind_at`
7. **展开** opens the Import workstation with the same session

## In-app alternative (no keyboard build)

Home → **从对话中发现** / route `/import` → clipboard paste → same parse/analyze/confirm
API. Works after an OTA that includes `ImportConversationScreen`; does not need Full Access.

## OTA vs new IPA

| Change | Ship via |
|---|---|
| Import UI, diagnostics screen, deep-link routing (JS) | OTA (`bun run update:preview`) |
| Keyboard Swift UI / App Group / shared-storage native module | **New native EAS / Xcode build** |
