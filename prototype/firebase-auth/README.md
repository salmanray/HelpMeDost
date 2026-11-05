# Firebase Email-Link Authentication Prototype (Isolated)

Status: experimental only. This directory is not wired into Astro routes, production builds, PR #7, Neon, or Cloudflare deployment.

## Purpose

Evaluate Firebase Authentication passwordless email-link sign-in as an alternative to HelpMeDost's current six-digit email OTP.

## Run locally

1. Create a Firebase project (or use a dedicated test project, not a production project).
2. In Firebase Console, enable Authentication -> Sign-in method -> Email/Password and Email link (passwordless sign-in).
3. Add `localhost` to Authentication -> Settings -> Authorized domains.
4. Copy the Firebase web app config into `index.html` where marked `YOUR_...`.
5. From this folder run a local static server, for example:
   `python -m http.server 4173`
6. Open `http://localhost:4173` and send a sign-in link to an email you control.
7. Open the link in the same browser/device for the simplest test. For a different device, the demo asks for the email again.

Do not use a production Firebase project or real customer data for this prototype.

## What this prototype tests

- Firebase sends the passwordless sign-in link.
- Link completion verifies the email address and signs the browser into Firebase.
- The browser can obtain a Firebase ID token after sign-in.
- Name and 10-digit Indian mobile are collected as prototype-only registration metadata; they are not written to Neon.

## What it deliberately does NOT do

- It does not create HelpMeDost accounts or write to Neon.
- It does not create HelpMeDost session cookies.
- It does not grant admin access.
- It does not replace or modify the current Resend/OTP implementation.
- It does not modify PR #7, main, Cloudflare settings, production secrets, or production database.
- It does not establish that the flow is production-ready.

## Next integration stage (only after review)

If approved, add a server endpoint that verifies Firebase ID tokens (signature, issuer, audience, expiry and subject) using Google's published signing keys, then maps the verified Firebase UID to the existing Neon user profile and issues the existing HttpOnly HelpMeDost session. Keep the admin email allowlist and add rate limits, origin/CSRF protections, mobile uniqueness checks and transactional profile/session writes. Do not trust client-supplied name, email, UID, role, or mobile without validation.

## Firebase settings / limitations

- Email-link sign-in requires the Email/Password provider and Email link sign-in method to be enabled.
- The action URL's domain must be in Firebase Authentication's Authorized domains.
- Firebase's Spark plan has a very low daily quota for email-link sign-in (currently 5/day); verify current quotas before choosing it for public launch.
- Use HTTPS for deployed environments.
