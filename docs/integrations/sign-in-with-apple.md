# Sign in with Apple

Alfred can mint a session from Apple’s native identity token so users in China (or
anyone who cannot complete Google OAuth) can use SMS, Apple Calendar, capture, and
chat without linking Gmail first. Gmail remains optional via Settings → Link Gmail.

## What was implemented

| Layer | Path |
|-------|------|
| Backend verify + session | `POST /api/v1/auth/apple` (`identity_token`, optional `full_name`, `email`) |
| Continue without mailbox | `POST /api/v1/auth/continue-without-gmail` |
| Config | `APPLE_CLIENT_ID` (audience = iOS bundle ID) |
| Mobile | `expo-apple-authentication` button on Connect |
| DB | `users.apple_sub` (unique, nullable) |

Google login is unchanged. Linking Gmail after Apple/anonymous uses the existing
`GET /api/v1/auth/google/link/start` flow (requires a session).

## Apple Developer Console (required for production SIWA)

Do these once with the team that owns `com.haoruiwang.alfred`:

1. **Certificates, Identifiers & Profiles → Identifiers → App IDs**  
   Select `com.haoruiwang.alfred` → enable **Sign In with Apple** → Save.

2. **Provisioning**  
   Regenerate/refresh the App Store / Ad Hoc / Development profiles so they include
   the Sign In with Apple entitlement. EAS Build usually picks this up on the next
   credentials sync (`eas credentials` / rebuild).

3. **No Services ID required for native iOS**  
   Native SIWA uses the **bundle ID** as the JWT `aud`. Set:

   ```bash
   APPLE_CLIENT_ID=com.haoruiwang.alfred
   ```

   on the API host (Hetzner `.env`). A Services ID + redirect URI is only needed if
   you later add web/Android SIWA.

4. **Deploy API** with migration `b4c5d6e7f8a9` (`users.apple_sub`) and the new env var.

5. **New native iOS build** after enabling the capability + adding
   `expo-apple-authentication` / `usesAppleSignIn`. JS-only OTA cannot add the
   entitlement. Until that build ships, users can still use **Continue without Gmail**
   (OTA) if the API is reachable.

## Mobile / EAS notes

- `app.json`: `ios.usesAppleSignIn: true` and the `expo-apple-authentication` plugin.
- SIWA only appears on iOS when `AppleAuthentication.isAvailableAsync()` is true
  (real device / simulator with Apple ID). Expo Go may not support it; use a
  development or preview build.
- OTA can ship the Connect UI + `continue-without-gmail` client; SIWA button needs
  the native module in the binary.

## Testing

```bash
# Backend (mocked Apple JWKS)
cd backend && uv run pytest tests/test_apple_auth.py -q

# Manual device
1. Deploy API with APPLE_CLIENT_ID + migration.
2. Install a build that includes Sign In with Apple.
3. Connect → Sign in with Apple → land in onboarding/tabs with no mailbox.
4. Settings → Add Gmail → link (optional).
5. Or: Continue without Gmail → same session path without Apple.
```

## Network errors vs SIWA

`Network request failed` on Connect means the device never reached
`https://alfredaitech.com` (DNS/TLS/firewall/GFW). SIWA and “continue without Gmail”
both call that API — they do **not** fix a blocked API host. Mitigations for China
reachability (alternate domain, CDN, CN edge) are separate from this auth work.
