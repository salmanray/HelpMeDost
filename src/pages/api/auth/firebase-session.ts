import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import {
  authEnv,
  isAdminEmail,
  issueSession,
  setSessionCookie,
  verifyFirebaseIdToken,
} from "../../../lib/auth";

function safeUserRedirect(value: unknown) {
  const path = cleanText(value, 500);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\r\n]/.test(path)) return "/account";
  try {
    const target = new URL(path, "https://helpmedost.local");
    if (target.origin !== "https://helpmedost.local" || target.pathname.startsWith("/admin")) return "/account";
    return path;
  } catch {
    return "/account";
  }
}

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const idToken = cleanText(body?.idToken, 6000);
    const name = cleanText(body?.name, 120);
    const mobile = cleanText(body?.mobile, 10);
    const mode = body?.mode === "register" ? "register" : "login";
    const purpose = body?.purpose === "admin" ? "admin" : "user";

    if (!idToken) return json({ error: "Please sign in first." }, 400);

    const env = authEnv(context);
    const firebaseUser = await verifyFirebaseIdToken(idToken, env);

    if (!firebaseUser.emailVerified) {
      return json({ error: "Please verify your email address before continuing." }, 403);
    }

    if (purpose === "admin" && !isAdminEmail(firebaseUser.email, env)) {
      return json({ error: "This Google/email account is not authorised for admin access." }, 403);
    }

    if (purpose === "user" && mode === "register" && (!name || !/^[6-9]\d{9}$/.test(mobile))) {
      return json({ error: "Please enter your name and a valid 10-digit Indian mobile number." }, 400);
    }

    const sql = getDb(context);
    const firebaseSubject = `firebase:${firebaseUser.uid}`;

    // Look up inactive records too: silently inserting a second profile for the
    // same email can violate unique constraints or bypass an account suspension.
    let profiles = await sql`
      SELECT id, full_name, email, user_type, auth_subject, mobile_number, status
      FROM user_profiles
      WHERE lower(email) = ${firebaseUser.email}
      LIMIT 1
    `;

    if (purpose === "admin") {
      if (profiles.length && profiles[0].status !== "active") {
        return json({ error: "This admin account is inactive. Contact the system owner." }, 403);
      }

      if (!profiles.length) {
        profiles = await sql`
          INSERT INTO user_profiles(auth_subject, full_name, email, user_type, status)
          VALUES(${firebaseSubject}, ${firebaseUser.displayName || "HelpMeDost Admin"}, ${firebaseUser.email}, 'admin', 'active')
          RETURNING id, full_name, email, user_type, auth_subject, mobile_number, status
        `;
      } else {
        // An allowlisted email is not permission to silently convert an
        // existing public account into an administrator.
        if (profiles[0].user_type !== "admin") {
          return json({ error: "The authorised email is linked to a non-admin profile. An administrator must provision this profile first." }, 403);
        }

        if (profiles[0].auth_subject && profiles[0].auth_subject !== firebaseSubject) {
          return json({ error: "This admin profile is linked to a different sign-in identity. Contact the system owner." }, 409);
        }

        if (!profiles[0].auth_subject) {
          profiles = await sql`
            UPDATE user_profiles
            SET auth_subject = ${firebaseSubject}
            WHERE id = ${profiles[0].id}
              AND user_type = 'admin'
              AND status = 'active'
              AND auth_subject IS NULL
            RETURNING id, full_name, email, user_type, auth_subject, mobile_number, status
          `;
          if (!profiles.length) {
            return json({ error: "The admin profile changed during sign-in. Please try again." }, 409);
          }
        }
      }
    } else if (mode === "register") {
      if (profiles.length && profiles[0].status !== "active") {
        return json({ error: "This account is inactive. Contact support." }, 403);
      }
      if (profiles.length && profiles[0].auth_subject !== firebaseSubject) {
        return json({ error: "An account already exists for this email. Please contact support to link it safely." }, 409);
      }

      const duplicate = await sql`
        SELECT id FROM user_profiles
        WHERE mobile_number = ${mobile}
          AND lower(email) <> ${firebaseUser.email}
        LIMIT 1
      `;
      if (duplicate.length) {
        return json({ error: "This mobile number is already linked to another account." }, 409);
      }

      if (!profiles.length) {
        profiles = await sql`
          INSERT INTO user_profiles(auth_subject, full_name, email, mobile_number, user_type, status)
          VALUES(${firebaseSubject}, ${name}, ${firebaseUser.email}, ${mobile}, 'public', 'active')
          RETURNING id, full_name, email, user_type, auth_subject, mobile_number, status
        `;
      } else {
        profiles = await sql`
          UPDATE user_profiles
          SET full_name = ${name}, mobile_number = ${mobile}
          WHERE id = ${profiles[0].id}
            AND status = 'active'
          RETURNING id, full_name, email, user_type, auth_subject, mobile_number, status
        `;
      }
    } else if (!profiles.length) {
      // First-time Google sign-in creates a basic profile; mobile can be added later.
      profiles = await sql`
        INSERT INTO user_profiles(auth_subject, full_name, email, user_type, status)
        VALUES(${firebaseSubject}, ${firebaseUser.displayName || "HelpMeDost User"}, ${firebaseUser.email}, 'public', 'active')
        RETURNING id, full_name, email, user_type, auth_subject, mobile_number, status
      `;
    } else {
      if (profiles[0].status !== "active") {
        return json({ error: "This account is inactive. Contact support." }, 403);
      }
      if (profiles[0].auth_subject !== firebaseSubject) {
        return json({ error: "This email is already linked to another sign-in method. Contact support to link it safely." }, 409);
      }
    }

    if (!profiles.length) {
      return json({ error: "Could not create or locate your account." }, 500);
    }

    const token = await issueSession(context, profiles[0].id, purpose);
    return new Response(
      JSON.stringify({ ok: true, redirectTo: purpose === "admin" ? "/admin" : safeUserRedirect(body?.next) }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Set-Cookie": setSessionCookie(token, purpose),
        },
      }
    );
  } catch (error) {
    console.error("Firebase session creation failed", error);
    return json({ error: "Unable to complete sign-in. Please try again or contact support." }, 500);
  }
};
