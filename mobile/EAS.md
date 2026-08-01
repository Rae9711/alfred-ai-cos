# Albert app: EAS build + TestFlight

The app's JS is currently served from a Mac (Metro tunnel/LAN). EAS makes it a real
installable app that pulls JS updates from Expo's cloud — friends install once, then get
updates with no Mac, no Expo Go, no tunnel.

Config already in the repo: `eas.json` (development/preview/production profiles + update
channels), `app.json` (expo-updates plugin, runtimeVersion appVersion, updates url filled
by `eas init`). `expo-updates` + `eas-cli` installed.

## One-time setup (needs YOUR logins — interactive)

Run these from `mobile/` (`! <cmd>` in the session so output is visible):

```
bunx eas login                       # your Expo account
bunx eas init                        # creates the EAS project, writes the real
                                     # projectId into app.json updates.url
```

## Fast friend installs (EAS internal — not App Store Connect)

```
bunx eas build --profile preview --platform ios
```

- EAS asks to log in to your Apple Developer account and handles certs/provisioning.
- Produces an **ad-hoc / internal** IPA; friends install via the EAS link (device UDIDs
  registered). This is **not** TestFlight.
- Android: `bunx eas build --profile preview --platform android` → APK.

## Real TestFlight (App Store Connect)

1. **Apple Developer**  
   - App ID `com.haoruiwang.alfred` with **Sign In with Apple** enabled.  
   - Refresh provisioning profiles (`eas credentials` / next EAS build).

2. **Prod API** (before testers open the app)  
   - `APPLE_CLIENT_ID=com.haoruiwang.alfred`  
   - Run migrations through `c5d6e7f8a9b0` (`users.apple_sub`, `users.sms_forward_token`)  
   - Confirm `https://alfredaitech.com/api/v1/integrations/ios/Albert-SMS-Forward.shortcut` serves 200

3. **Store build + submit**

```
bunx eas build --profile production --platform ios
bunx eas submit --platform ios --latest
```

- `production` uses App Store distribution (required for TestFlight).  
- After upload, enable the build in App Store Connect → TestFlight → Internal Testing.  
- Add internal testers (same Apple team) or external testers (may need Beta App Review).

4. **Native rebuild required** when entitlements change (SIWA, keyboard, contacts,
   calendar, microphone). JS-only `eas update` cannot add those.

## Ship JS updates after the first build (no rebuild)

After any JS change (screens, fixes) that does **not** need new native code:

```
bunx eas update --branch preview -m "what changed"      # internal/preview installs
bunx eas update --branch production -m "what changed"  # TestFlight / store builds
```

Installed apps pick it up on next launch. Rebuild only when native deps or iOS
capabilities change. See `docs/integrations/sign-in-with-apple.md`.

## Notes

- `apiBaseUrl` is already `https://alfredaitech.com` (the durable backend), so
  the built app talks to prod with no Mac involved.
- runtimeVersion policy = appVersion: JS updates apply to builds sharing app version 0.1.0.
  Bump `version` in app.json when native changes require a fresh build.
- The OAuth deep link is `albert://auth`; in a standalone build the albert:// scheme is
  registered natively, so Google sign-in returns into the app cleanly (unlike Expo Go).
- Prefer **Sign in with Apple** for testers who need durable identity without Gmail.
  “Continue without Gmail” mints a new anonymous user if the local JWT is lost.
