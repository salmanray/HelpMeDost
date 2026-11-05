import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import { authEnv, normaliseEmail, validEmail, isAdminEmail, createOtpHash, issueSession, setSessionCookie } from "../../../lib/auth";

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const email = normaliseEmail(body.email);
    const otp = cleanText(body.otp, 6);
    const name = cleanText(body.name, 120);
    const purpose = body.purpose === "admin" ? "admin" : "user";
    if (!validEmail(email) || !/^\d{6}$/.test(otp)) return json({ error: "Enter your email and six-digit verification code." }, 400);
    const env = authEnv(context);
    if (purpose === "admin" && !isAdminEmail(email, env)) return json({ error: "This email is not authorised for admin access." }, 403);
    const sql = getDb(context);
    const rows = await sql`SELECT id, otp_hash, attempts FROM auth_email_otps
      WHERE email=${email} AND purpose=${purpose} AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`;
    if (!rows.length) return json({ error: "Code expired or not found. Please request a new one." }, 400);
    if (Number(rows[0].attempts) >= 5) return json({ error: "Too many incorrect attempts. Please request a new code." }, 429);
    const expected = await createOtpHash(email, otp, env);
    if (rows[0].otp_hash !== expected) {
      await sql`UPDATE auth_email_otps SET attempts=attempts+1 WHERE id=${rows[0].id}`;
      return json({ error: "Incorrect verification code." }, 400);
    }
    await sql`UPDATE auth_email_otps SET consumed_at=now() WHERE id=${rows[0].id} AND consumed_at IS NULL`;
    let profiles = await sql`SELECT id, full_name, email, user_type FROM user_profiles WHERE lower(email)=${email} AND status='active' LIMIT 1`;
    if (purpose === "user" && !profiles.length) {
      if (!name) return json({ error: "Please register with your name first." }, 400);
      profiles = await sql`INSERT INTO user_profiles(auth_subject,full_name,email,user_type,status)
        VALUES(${"email:"+email},${name},${email},'public','active')
        ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email
        RETURNING id,full_name,email,user_type`;
    }
    if (purpose === "admin" && !profiles.length) {
      profiles = await sql`INSERT INTO user_profiles(auth_subject,full_name,email,user_type,status)
        VALUES(${"email:"+email},${name || "HelpMeDost Admin"},${email},'admin','active')
        ON CONFLICT (email) DO UPDATE SET user_type='admin',status='active'
        RETURNING id,full_name,email,user_type`;
    }
    if (!profiles.length) return json({ error: "Account could not be found. Please register first." }, 404);
    if (purpose === "admin" && profiles[0].user_type !== "admin") {
      await sql`UPDATE user_profiles SET user_type='admin' WHERE id=${profiles[0].id}`;
    }
    const token = await issueSession(context, profiles[0].id, purpose);
    return new Response(JSON.stringify({ ok:true, user:{name:profiles[0].full_name,email:profiles[0].email,role:purpose}, redirectTo: purpose === "admin" ? "/admin" : "/account" }), {
      status:200, headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":setSessionCookie(token)}
    });
  } catch (error) {
    console.error("OTP verification failed", error);
    return json({ error: "Unable to verify code right now." }, 500);
  }
};
