# Albert app: EAS build + update (laptop-independent app)

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

## Build for friends (TestFlight-style, no App Store review)

```
bunx eas build --profile preview --platform ios
```

- EAS asks to log in to your Apple Developer account and handles certs/provisioning.
- Produces an installable build; distribute via the EAS link or TestFlight.
- Android (free, no Apple): `bunx eas build --profile preview --platform android` → APK.

## Ship JS updates after the first build (no rebuild, instant)

After any JS change (screens, fixes):

```
bunx eas update --branch preview -m "what changed"
```

Installed apps pick it up on next launch. This is the durable loop: rebuild only when
native deps change; otherwise `eas update` and everyone has it in seconds.

## Notes

- `apiBaseUrl` is already `https://albert.alfredassistants.com` (the durable backend), so
  the built app talks to prod with no Mac involved.
- runtimeVersion policy = appVersion: JS updates apply to builds sharing app version 0.1.0.
  Bump `version` in app.json when native changes require a fresh build.
- The OAuth deep link is `albert://auth`; in a standalone build the albert:// scheme is
  registered natively, so Google sign-in returns into the app cleanly (unlike Expo Go).
