# ONE-OS authentication setup and Android test guide

This guide applies to the Android app on the `fix/phase1-auth-google-password-redirect` branch.

## What the app expects

- Email/password sign-up and sign-in use the full email address as the login identifier.
- Passwords are passed to Supabase exactly as typed. The client requires at least 8 characters; it does not strip punctuation or reject commas, hyphens, underscores, or other generated-password symbols.
- Email confirmation and password-reset links use the Android app deep link `oneos://auth`.
- Google sign-in requests the same `oneos://auth` callback and relies on the existing AuthProvider PKCE deep-link handler to exchange the one-time code.

## Required Supabase Dashboard configuration

These settings are external to the Git repository and cannot be changed by an APK build.

1. Open the correct Supabase project.
2. Go to **Authentication → URL Configuration**.
3. Add the exact redirect URL `oneos://auth` to **Redirect URLs / Additional Redirect URLs** and save.
4. Check **Site URL**. It must not be `http://localhost:3000` for the deployed app. Set it to a real HTTPS site you control, or another intentional production fallback. The mobile flow should still pass the explicit `oneos://auth` redirect.
5. Open **Authentication → Email Templates → Confirm signup** and **Reset Password**. Keep the Supabase confirmation link variable (normally `{{ .ConfirmationURL }}`) in the action link. Do not hard-code `http://localhost:3000` in the template.
6. In **Authentication → Providers → Google**, enable Google and supply the OAuth client ID and client secret.
7. In Google Cloud Console, configure the OAuth web client with this authorized redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
   Copy that OAuth client ID/secret into the Supabase Google provider settings. Do not put the Google client secret in the Android app or repository.
8. Save provider settings and test using the newly built APK. Existing APKs do not gain new code just because dashboard settings changed.

If the confirmation email still opens localhost after these settings are saved, inspect the actual email link and the Supabase Auth logs. Do not manually edit a one-time confirmation token or share it.

## Android test sequence

Use a real test email inbox that you control.

1. Install the latest debug APK from the auth-fix branch.
2. Create an account with your email and a password of at least 8 characters. A generated password containing punctuation is valid input; preserve it exactly.
3. Open the confirmation email on the same Android phone. The link should return to ONE-OS, not a browser page at localhost.
4. Return to the app and sign in with the full email address and exact password.
5. Sign out, then repeat sign-in to check session restoration.
6. Test Google separately after the Supabase Google provider and Google Cloud OAuth client are configured.
7. Test a wrong password and a password-reset link. Do not use production or personal accounts for negative/security tests.

## Test credentials

There is no seeded/demo account in the repository. Create a test account through the app using an email inbox you control. Login identifier = that full email address; password = the exact password you chose/generated at signup. Do not store test passwords in source code, GitHub issues, commits, screenshots, or chat.

## What CI can and cannot prove

TypeScript and automated tests can verify the code compiles and that password characters are not rewritten in the client. Only a real Android device plus the configured Supabase/Google provider can prove that email confirmation and Google OAuth callbacks work end to end.
