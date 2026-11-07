# HelpMeDost

HelpMeDost is a phased assistance platform connecting students, parents, professionals, and service partners.

## Authentication architecture (free-first)
- Firebase Authentication Spark plan: Google sign-in and Email/Password.
- Email-link/passwordless sign-in is not used.
- Firebase handles email verification and password reset; no Resend OTP is required for login.
- Cloudflare Pages hosts the application; Neon PostgreSQL stores HelpMeDost profiles and application records.
- The server verifies Firebase ID tokens through Firebase Identity Toolkit before issuing an HttpOnly HelpMeDost session.
- Admin access is separately restricted by the server-side ADMIN_EMAILS allowlist.

## Cloudflare configuration
Set the following build variables from Firebase Console > Project settings > Your apps > Web app:
- PUBLIC_FIREBASE_API_KEY
- PUBLIC_FIREBASE_AUTH_DOMAIN
- PUBLIC_FIREBASE_PROJECT_ID
- PUBLIC_FIREBASE_APP_ID

Set runtime variables:
- FIREBASE_API_KEY (same Firebase Web API key)
- FIREBASE_PROJECT_ID
- ADMIN_EMAILS

Keep DATABASE_URL as an encrypted secret. Do not add Firebase service-account private keys or expose database credentials in browser code.

## Local sign-in

Cloudflare's encrypted production/preview secrets are not automatically copied into local development. To configure local sign-in:

1. Copy `.dev.vars.example` to `.dev.vars` and fill in the values from a development Firebase Web app and an isolated development Neon database.
2. The local database must contain the existing HelpMeDost base schema. Apply the Dost AI migration only to this development database when you want to test chat.
3. Never put a production `DATABASE_URL` in `.dev.vars`; sign-in creates user profile and session records.
4. Restart `npm run dev` after saving `.dev.vars`.

`.dev.vars` is ignored by Git. Local sign-in will return a Firebase configuration error until `PUBLIC_FIREBASE_API_KEY` and the other web app values are filled in. The server also needs `FIREBASE_API_KEY` and `DATABASE_URL` to create a HelpMeDost session.

## Initial launch
The first release focuses on the Student Help Portal. The wider platform will be developed in phases, following the approved HelpMeDost product blueprint.

## Hosting
Cloudflare Pages project: helpmedost (helpmedost.pages.dev).
