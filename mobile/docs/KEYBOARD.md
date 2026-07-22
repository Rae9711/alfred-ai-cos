# Alfred Keyboard Extension

Custom iOS keyboard that drafts chat replies in place: **screenshot-first for any
messenger**, WeChat multi-select copy as fallback. Replies are auto-inserted;
the user only taps the host app's Send.

## Primary flow (all chats: WeChat / SMS / WhatsApp / Instagram / …)

1. Screenshot the current chat thread (system gesture).
2. Switch to the Alfred keyboard (Full Access + signed-in App Group token).
3. Keyboard auto-picks the newest screenshot (last ~45s) → Vision OCR →
   `/conversations/analyze` → **auto `insertText`**.
4. Screenshot asset is **deleted from Photos** after OCR.
5. User taps the host **Send** button. Optional: 换一个 / 撤销.

## Fallback (WeChat multi-select)

1. Multi-select → Copy.
2. Switch to Alfred → auto parse → analyze → auto insert (no 导入 / 下一步).
3. If speakers are ambiguous, tap **我是谁** once (saved in App Group).

## Requirements

- Custom/dev client build (not Expo Go) — run `npx expo prebuild --platform ios`
  then open `ios/` in Xcode, or build with EAS (`eas build --profile preview`).
- App Group `group.com.haoruiwang.alfred` on both the app and the keyboard target.
- Keyboard **Full Access** enabled (clipboard + network).
- **Photo Library** access (read/write) so the keyboard can OCR then delete the
  temporary screenshot.
- User signed in to the main Alfred app (session token is mirrored into the App Group).

## Build (cloud / CI-friendly)

```bash
cd mobile
bun run prebuild:ios          # expo prebuild + wire-alfred-keyboard.cjs
# On a Mac with Xcode: open ios/*.xcworkspace, confirm Embed App Extensions,
# App Groups on both targets, then:
bun run device:ios            # or: eas build --profile preview --platform ios
```

`scripts/wire-alfred-keyboard.cjs` attaches Swift sources (including
`AlfredScreenshotImporter.swift`), `AlfredKeyboard-Info.plist`, and entitlements.

Keyboard Swift / entitlements / target changes **require a new native build**, not OTA.

## State machine

```
IDLE → IMPORTING → [PICKING_SELF?] → GENERATING → SUCCESS (auto-insert)
```

Legacy CONTEXT_INSIGHT / REPLY_READY remain for manual fallback UI.

## Self identity

Backend `apply_self_identity` marks `我` / `对方` from account name, saved
`alfred.chat_self_name`, or OCR left/right bubbles. Analyze prompts use those
labels and the user's own bubbles as style samples.

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

### Full Access detection chain (keyboard)

`authGateMessage()` is evaluated live on every IDLE render and on `viewWillAppear`
(never caches `hasFullAccess`):

| Order | Condition | Banner |
|---|---|---|
| 1 | `!hasFullAccess` | 需要允许完全访问 |
| 2 | FA on, App Group container URL nil | 未发现共享容器 |
| 3 | FA on, container OK, no JWT in suite | 主 App 尚未同步 |
| 4 | FA on + token | IDLE — 「检测到微信聊天」+ [导入所选聊天] |

Import then needs FA for **clipboard** (`UIPasteboard`) and **network** (`URLSession`).
Token comes from App Group (synced by main app via `AlfredSharedStorage`).

### Strict FA toggle test (device)

1. Install IPA → open Alfred → sign in → **同步键盘登录状态** (诊断: App Group 可访问 + Token 已写入).
2. Add Alfred keyboard; leave **Allow Full Access OFF**.
3. Notes/微信 → switch to Alfred → banner **must** be「需要允许完全访问」(no import CTA).
4. Settings → Alfred keyboard → enable **Allow Full Access** → confirm dialog.
5. Return to Notes/微信 → **dismiss keyboard fully**, then reopen and switch to Alfred.
6. Banner **must leave**「需要允许完全访问」:
   - If sync skipped →「主 App 尚未同步」or「未发现共享容器」
   - If synced → IDLE with [导入所选聊天]
7. Toggle FA **OFF** again → reopen keyboard → banner must return to「需要允许完全访问」.
8. FA ON + WeChat multi-select copy → [导入所选聊天] → IMPORTING (parse) → insight → generate (network).

## Diagnostics (main app)

You → **键盘诊断** (`/keyboard-diagnostics`) shows real status:

| Row | Values |
|---|---|
| Keyboard Extension | Best-effort via last-seen marker; otherwise honest「无法从主 App 检测…」 |
| App Group | 可访问 / 不可访问 |
| Auth Token | 已写入 / 未写入 |
| Token Updated | timestamp or — |
| Full Access | Guidance only — main app cannot read FA;「请在系统设置中开启」 |

**同步键盘登录状态** calls `syncAuthToAppGroup` and refreshes the panel. If the
native `AlfredSharedStorage` module is missing from the IPA, sync now reports an
explicit error instead of a fake success.

App Group suite must never silently fall back to `UserDefaults.standard`. Availability
is probed via `FileManager.containerURL(forSecurityApplicationGroupIdentifier:)` — **not**
`UserDefaults(suiteName:) != nil` (that API almost never returns nil and can create a
process-local store, which falsely looks like「可访问 / 已写入」while the keyboard sees
no token). Suite failure surfaces as「未发现共享容器」in the keyboard.

## Keyboard error copy

| Condition | Message |
|---|---|
| `!hasFullAccess` | 需要允许完全访问 |
| App Group suite unavailable | 未发现共享容器 |
| Full Access on, container OK, no token | 主 App 尚未同步 |
| API 401 / expired | 登录已过期 |
| Network failure | 网络不可用 |
| No recent screenshot | 未找到最近截图 — 请先截一张当前聊天 |
| Photo library denied | 需要相册权限以读取截图 |

## UI notes

- **IDLE:** screenshot / clipboard detection + [识别截图] [用剪贴板]
- **IMPORTING / GENERATING:** progress, then auto-insert
- **PICKING_SELF:** one-time speaker chips when identity is ambiguous
- **SUCCESS:** 「已填入，点发送即可」+ 换一个 / 撤销 + optional follow-up cards

Bottom chrome: 🌐 123 空格 ⌫ blue ↵ (no full QWERTY).

**展开** / **打开 Alfred** use `albert://…`. Host apps (esp. WeChat) often block
extension `openURL`; fallback copies the deep link to the pasteboard.

## Deep link

- Scheme: `albert` (not `alfred`)
- `albert://conversation/{id}` → Import workstation with handoff
- Confirm actions: `POST /conversations/actions/confirm` + App Group drain for reminders

## In-app alternative (no keyboard build)

Home → **从对话中发现** / `/import` → clipboard paste → same parse/analyze/confirm APIs.

## OTA vs new IPA

| Change | Ship via |
|---|---|
| Import UI, diagnostics screen, deep-link routing (JS) | OTA (`bun run update:preview`) |
| Keyboard Swift / screenshot OCR / Info.plist privacy | **New native EAS / Xcode build** |
