import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import { authEnv, normaliseEmail, validEmail, isAdminEmail, createOtpHash, issueSession, setSessionCookie } from "../../../lib/auth";

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const email = normaliseEmail(body.email);
    const otp = cleanText(body.otp, 6);
    const name = cleanText(body.name, 120);
    const mobile = cleanText(body.mobile, 10);
    const purpose = body.purpose === "admin" ? "admin" : "user";
    if (!validEmail(email) || !/^\d{6}$/.test(otp)) return json({ error: "Enter your email and six-digit verification code." }, 400);
    if (purpose === "user" && body.mobile !== undefined && !/^[6-9]\d{9}$/.test(mobile)) return json({ error: "Please enter a valid 10-digit Indian mobile number." }, 400);
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
      const attempt = await sql`UPDATE auth_email_otps SET attempts=attempts+1 WHERE id=${rows[0].id} AND attempts < 5 RETURNING attempts`;
      if (!attempt.length) return json({ error: "Too many incorrect attempts. Please request a new code." }, 429);
      return json({ error: "Incorrect verification code." }, 400);
    }
    const consumed = await sql`UPDATE auth_email_otps SET consumed_at=now() WHERE id=${rows[0].id} AND consumed_at IS NULL RETURNING id`;
    if (!consumed.length) return json({ error: "This code has already been used. Please request a new one." }, 409);
    let profiles = await sql`SELECT id, full_name, email, user_type FROM user_profiles WHERE lower(email)=${email} AND status='active' LIMIT 1`;
    if (purpose === "user" && !profiles.length) {
      if (!name) return json({ error: "Please register with your name first." }, 400);
      profiles = await sql`INSERT INTO user_profiles(auth_subject,full_name,email,mobile_number,user_type,status)
        VALUES(${"email:"+email},${name},${email},${mobile || null},'public','active')
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
    if (purpose === "user" && mobile) {
      const mobileUpdate = await sql`UPDATE user_profiles SET mobile_number=${mobile}
        WHERE id=${profiles[0].id} AND (mobile_number IS NULL OR mobile_number=${mobile}) RETURNING id`;
      if (!mobileUpdate.length) return json({ error: "This mobile number is already linked to another account." }, 409);
    }
    if (purpose === "admin" && profiles[0].user_type !== "admin") {
      await sql`UPDATE user_profiles SET user_type='admin' WHERE id=${profiles[0].id}`;
    }
    const token = await issueSession(context, profiles[0].id, purpose);
    return new Response(JSON.stringify({ ok:true, user:{name:profiles[0].full_name,email:profiles[0].email,role:purpose}, redirectTo: purpose === "admin" ? "/admin" : "/account" }), {
      status:200, headers:{"Content-Type":"application/json","Cache-Control":"no-store","Set-Cookie":setSessionCookie(token,purpose)}
    });
  } catch (error) {
    console.error("OTP verification failed", error);
    return json({ error: "Unable to verify code right now." }, 500);
  }
};
