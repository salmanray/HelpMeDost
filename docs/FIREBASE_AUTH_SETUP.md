# HelpMeDost Firebase Auth + Cloudflare setup

## Current architecture

- **Client**: Firebase Web SDK (Google popup + email/password). Config from `PUBLIC_FIREBASE_*` (build-time).
- **Server**: Identity Toolkit `accounts:lookup` verifies ID tokens. Creates `auth_sessions` rows and sets `hmd_session` HttpOnly cookie.
- **Admin**: Only emails listed in runtime `ADMIN_EMAILS` may receive `purpose=admin` sessions. No shared `ADMIN_ACCESS_KEY` on the Firebase path.
- **Free requests**: `/api/requests` stays open without login (anonymous free questions preserved).

## Required Cloudflare Pages variables

### Build variables (Production + Preview)

| Variable | Example |
|----------|---------|
| `PUBLIC_FIREBASE_API_KEY` | (Web API key from Firebase project settings) |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | `helpmedost-auth-test.firebaseapp.com` |
| `PUBLIC_FIREBASE_PROJECT_ID` | `helpmedost-auth-test` |
| `PUBLIC_FIREBASE_APP_ID` | `1:547646128261:web:ab7f5e18eebe6269da69ec` |

Without these at **build** time, the client bundle throws "Firebase web configuration is missing".

### Runtime variables (Production + Preview)

| Variable | Notes |
|----------|-------|
| `FIREBASE_API_KEY` | Same Web API key; used by `/api/auth/firebase-session` |
| `FIREBASE_PROJECT_ID` | `helpmedost-auth-test` |
| `ADMIN_EMAILS` | `mr.ray.rs@gmail.com` (comma-separated allowlist) |
| `DATABASE_URL` | Neon connection string |

After changing build variables, trigger a **new deployment** (redeploy). Saving alone does not rebuild.

## Firebase Console checklist

1. Authentication → Sign-in method: enable **Google** and **Email/Password**.
2. Authentication → Settings → **Authorised domains** must include:
   - `helpmedost.pages.dev`
   - `helpmedost.in` (and `www` if used)
   - Stable preview host if configured (e.g. `preview.helpmedost.in` or `fix-firebase-auth-cloudflare.helpmedost.pages.dev`)
3. Do **not** add every unique deployment hash URL.
4. Google Cloud Console (same project): ensure the Web API key is not restricted in a way that blocks Identity Toolkit `accounts:lookup` from Cloudflare IPs (or leave unrestricted for the test project).

## Stable preview URL

Cloudflare Pages issues a unique `*.pages.dev` URL per deployment. Options:

1. **Branch alias (recommended first)**: every push to a named branch gets a stable URL:
   `https://<branch-name>.helpmedost.pages.dev`
   Example: `https://fix-firebase-auth-cloudflare.helpmedost.pages.dev`
2. **Custom domain**: add `preview.helpmedost.in` in Cloudflare Pages → Custom domains, point DNS, then add that hostname to Firebase authorised domains.

## Database migrations (do not auto-apply to production)

- `004_email_otp_auth.sql` — creates `auth_sessions` (required). OTP table is legacy and unused by Firebase path.
- `005_user_mobile_number.sql` — optional mobile uniqueness for registered users.

Apply on an isolated Neon branch first. Production schema must already have `user_profiles` with `auth_subject`, `status`, `user_type`, etc.

## Security notes

- Admin authorisation is enforced server-side in `/api/admin/*` via session purpose + `user_type`.
- Session cookies: `HttpOnly; Secure; SameSite=Lax`.
- Admin sessions expire in 30 minutes; user sessions in 7 days.
- Logout deletes the session row and clears the cookie.
- Unauthorized emails cannot obtain admin purpose even if they authenticate with Firebase.
