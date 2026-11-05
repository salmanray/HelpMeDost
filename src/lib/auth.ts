import type { APIContext } from "astro";
import { getDb } from "./db";

type Env = { RESEND_API_KEY?: string; AUTH_OTP_SECRET?: string; ADMIN_EMAILS?: string; AUTH_FROM_EMAIL?: string };
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
const randomHex = (length = 32) => { const bytes = crypto.getRandomValues(new Uint8Array(length)); return Array.from(bytes, b => b.toString(16).padStart(2,"0")).join(""); };
async function digest(value: string) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}
export function authEnv(context: APIContext): Env { return context.locals.runtime?.env as Env || {}; }
export function normaliseEmail(value: unknown) { return typeof value === "string" ? value.trim().toLowerCase() : ""; }
export function validEmail(value: string) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function isAdminEmail(email: string, env: Env) {
  return (env.ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean).includes(email);
}
export async function sendOtp(email: string, otp: string, env: Env) {
  if (!env.RESEND_API_KEY || !env.AUTH_FROM_EMAIL) throw new Error("Email delivery is not configured yet.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.AUTH_FROM_EMAIL,
      to: [email],
      subject: "Your HelpMeDost sign-in code",
      text: `Your HelpMeDost verification code is ${otp}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2>HelpMeDost verification</h2><p>Use this code to securely sign in:</p><div style="font-size:32px;letter-spacing:8px;font-weight:700;padding:16px 0">${otp}</div><p>This code expires in 10 minutes. Do not share it with anyone.</p></div>`
    })
  });
  if (!response.ok) throw new Error("We could not send the verification email. Please try again later.");
}
export async function createOtpHash(email: string, otp: string, env: Env) {
  if (!env.AUTH_OTP_SECRET) throw new Error("Authentication is not configured yet.");
  return hmac(`${email}:${otp}`, env.AUTH_OTP_SECRET);
}
export function cookieToken(context: APIContext) {
  const cookie = context.request.headers.get("cookie") || "";
  return cookie.split(";").map(x => x.trim()).find(x => x.startsWith("hmd_session="))?.slice("hmd_session=".length) || "";
}
export async function currentAuth(context: APIContext) {
  const token = cookieToken(context);
  if (!token) return null;
  const sql = getDb(context);
  const tokenHash = await digest(token);
  const rows = await sql`SELECT p.id, p.full_name, p.email, p.user_type, s.purpose
    FROM auth_sessions s JOIN user_profiles p ON p.id=s.profile_id
    WHERE s.token_hash=${tokenHash} AND s.expires_at > now() AND p.status='active' LIMIT 1`;
  return rows[0] || null;
}
export async function issueSession(context: APIContext, profileId: string, purpose: "user"|"admin") {
  const token = randomHex(32);
  const sql = getDb(context);
  await sql`INSERT INTO auth_sessions (token_hash, profile_id, purpose, expires_at)
    VALUES (${await digest(token)}, ${profileId}::uuid, ${purpose}, now() + interval '7 days')`;
  return token;
}
export function setSessionCookie(token: string) {
  return `hmd_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
}
export function clearSessionCookie() { return "hmd_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"; }
export { digest, randomHex };
