import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";
import { authEnv, normaliseEmail, validEmail, isAdminEmail, sendOtp, createOtpHash } from "../../../lib/auth";

export const POST: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const email = normaliseEmail(body.email);
    const name = cleanText(body.name, 120);
    const mobile = cleanText(body.mobile, 10);
    const purpose = body.purpose === "admin" ? "admin" : "user";
    if (!validEmail(email)) return json({ error: "Please enter a valid email address." }, 400);
    if (purpose === "user" && body.mode === "register" && !name) return json({ error: "Please enter your name." }, 400);
    if (purpose === "user" && body.mode === "register" && !/^[6-9]\d{9}$/.test(mobile)) return json({ error: "Please enter a valid 10-digit Indian mobile number." }, 400);
    const env = authEnv(context);
    if (purpose === "admin" && !isAdminEmail(email, env)) return json({ error: "This email is not authorised for admin access." }, 403);
    const sql = getDb(context);
    const existing = await sql`SELECT id FROM user_profiles WHERE lower(email)=${email} AND status='active' LIMIT 1`;
    if (purpose === "user" && body.mode !== "register" && !existing.length) return json({ error: "No account found. Please register first." }, 404);
    if (purpose === "user" && body.mode === "register" && existing.length) return json({ error: "An account already exists. Please sign in." }, 409);
    if (purpose === "user" && body.mode === "register") {
      const duplicateMobile = await sql`SELECT id FROM user_profiles WHERE mobile_number=${mobile} AND lower(email)<>${email} LIMIT 1`;
      if (duplicateMobile.length) return json({ error: "This mobile number is already linked to another account." }, 409);
    }
    const recent = await sql`SELECT id FROM auth_email_otps WHERE email=${email} AND created_at > now() - interval '60 seconds' ORDER BY created_at DESC LIMIT 1`;
    if (recent.length) return json({ error: "Please wait one minute before requesting another code." }, 429);
    const hourly = await sql`SELECT count(*)::int AS total FROM auth_email_otps WHERE email=${email} AND created_at > now() - interval '1 hour'`;
    if (Number(hourly[0]?.total || 0) >= 5) return json({ error: "Too many verification requests. Please try again later." }, 429);
    const daily = await sql`SELECT count(*)::int AS total FROM auth_email_otps WHERE email=${email} AND created_at > now() - interval '24 hours'`;
    if (Number(daily[0]?.total || 0) >= 10) return json({ error: "Daily verification limit reached. Please try again tomorrow." }, 429);
    const otp = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6,"0");
    const otpHash = await createOtpHash(email, otp, env);
    const inserted = await sql`INSERT INTO auth_email_otps(email,purpose,otp_hash,expires_at) VALUES(${email},${purpose},${otpHash},now()+interval '10 minutes') RETURNING id`;
    try {
      await sendOtp(email, otp, env);
    } catch (deliveryError) {
      await sql`DELETE FROM auth_email_otps WHERE id=${inserted[0].id} AND consumed_at IS NULL`;
      throw deliveryError;
    }
    return json({ ok: true, message: "Verification code sent. Please check your email." });
  } catch (error) {
    console.error("OTP request failed", error);
    return json({ error: error instanceof Error ? error.message : "Unable to send verification code." }, 500);
  }
};
