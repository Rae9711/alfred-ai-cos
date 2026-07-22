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

## State machine UI (~320pt, cool white / deep-blue mockup)

```
IDLE → IMPORTING → CONTEXT_INSIGHT → GENERATING → REPLY_READY → EDITING → SUCCESS
```

Visual language: white / light-gray panels, deep-blue primary CTAs, light-blue reply
bubble (not the earlier beige paper look). Header: **Alfred** + sparkles + chevron
(chevron → 展开 deep link when a conversation exists, else next keyboard).

- **IDLE:** mascot + 「检测到微信聊天」+ clipboard count hint + capability bullets + [导入所选聊天]
- **IMPORTING:** spinner while `POST /parse`
- **CONTEXT_INSIGHT:** heuristic 「Alfred 理解」+ evidence bubbles from top selected messages + [下一步：生成回复]
- **GENERATING:** spinner + checklist (解析 → 情绪意图 → 关键信息 → 生成回复…) while `POST /analyze`
- **REPLY_READY:** light-blue 推荐回复 bubble + [编辑] [插入微信]
- **EDITING:** TextView + `n/200` counter + tone chips 更短 / 更温柔 / 更坚定 + [插入微信]
- **SUCCESS:** checkmark 「已插入微信」+ follow-up action cards ([添加提醒]) + 完成 → IDLE

Bottom chrome: 🌐 123 空格 ⌫ blue ↵ (minimal bar styled closer to the mockup; no full QWERTY).

Mascot asset: `targets/AlfredKeyboard/alfred-mascot.png` (copied into the extension
Resources phase by `keyboard-wiring.cjs`).

**展开** (header chevron when session exists) opens `albert://conversation/{conversationId}`
(scheme from `app.json`), writing parse/analyze session into App Group handoff so Import can hydrate.

Keyboard Swift / assets / entitlements changes **require a new native IPA** — OTA will not update the extension UI.

## Deep link

- Scheme: `albert` (not `alfred`)
- `albert://conversation/{id}` → `/conversation/[id]` → `ImportConversationScreen` with handoff
- Confirm actions: `POST /conversations/actions/confirm` + App Group drain for reminders

## Flow

1. User multi-selects WeChat messages → Copy
2. Switch to Alfred Keyboard → tap **导入所选聊天**
3. Extension calls `POST /conversations/parse` → context insight → **下一步：生成回复** → `/analyze`
4. User inserts a reply via `textDocumentProxy.insertText` (插入微信) → success + follow-ups
5. User confirms an action → `POST /conversations/actions/confirm` + enqueue into App Group
6. Main app drains App Group on foreground and schedules a local notification **only**
   if the confirmed action has `remind_at`
7. Header chevron / 展开 opens the Import workstation with the same session

## In-app alternative (no keyboard build)

Home → **从对话中发现** / route `/import` → clipboard paste → same parse/analyze/confirm
API. Works after an OTA that includes `ImportConversationScreen`; does not need Full Access.

## OTA vs new IPA

| Change | Ship via |
|---|---|
| Import UI, diagnostics screen, deep-link routing (JS) | OTA (`bun run update:preview`) |
| Keyboard Swift UI / App Group / shared-storage native module | **New native EAS / Xcode build** |
