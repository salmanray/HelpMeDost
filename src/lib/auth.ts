import type { APIContext } from "astro";
import { getDb } from "./db";

type Env = {
  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  ADMIN_EMAILS?: string;
};

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const randomHex = (length = 32) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

async function digest(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function authEnv(context: APIContext): Env {
  return (context.locals.runtime?.env as Env) || {};
}

export function normaliseEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isAdminEmail(email: string, env: Env) {
  return (env.ADMIN_EMAILS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

/**
 * Verify a Firebase ID token via Identity Toolkit accounts:lookup.
 * Requires FIREBASE_API_KEY and FIREBASE_PROJECT_ID in Cloudflare runtime env.
 * Does not trust client claims alone.
 */
export async function verifyFirebaseIdToken(idToken: string, env: Env) {
  if (!env.FIREBASE_API_KEY || !env.FIREBASE_PROJECT_ID) {
    throw new Error(
      "Firebase server configuration is missing. Set FIREBASE_API_KEY and FIREBASE_PROJECT_ID as Cloudflare Pages runtime variables."
    );
  }
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Firebase token lookup failed", response.status, detail.slice(0, 200));
    throw new Error("Firebase token could not be verified.");
  }
  const data = (await response.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      emailVerified?: boolean;
      displayName?: string;
    }>;
  };
  const user = data.users?.[0];
  if (!user?.localId || !user.email) {
    throw new Error("Firebase returned an incomplete account.");
  }
  return {
    uid: user.localId,
    email: normaliseEmail(user.email),
    emailVerified: user.emailVerified === true,
    displayName: user.displayName || "",
  };
}

export function cookieToken(context: APIContext) {
  const cookie = context.request.headers.get("cookie") || "";
  return (
    cookie
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("hmd_session="))
      ?.slice("hmd_session=".length) || ""
  );
}

export async function currentAuth(context: APIContext) {
  const token = cookieToken(context);
  if (!token) return null;
  const sql = getDb(context);
  const tokenHash = await digest(token);
  const rows = await sql`
    SELECT p.id, p.full_name, p.email, p.user_type, s.purpose
    FROM auth_sessions s
    JOIN user_profiles p ON p.id = s.profile_id
    WHERE s.token_hash = ${tokenHash}
      AND s.expires_at > now()
      AND p.status = 'active'
    LIMIT 1`;
  return rows[0] || null;
}

export async function issueSession(
  context: APIContext,
  profileId: string,
  purpose: "user" | "admin"
) {
  const token = randomHex(32);
  const sql = getDb(context);
  await sql`
    INSERT INTO auth_sessions (token_hash, profile_id, purpose, expires_at)
    VALUES (
      ${await digest(token)},
      ${profileId}::uuid,
      ${purpose},
      now() + CASE WHEN ${purpose} = 'admin' THEN interval '30 minutes' ELSE interval '7 days' END
    )`;
  return token;
}

export function setSessionCookie(token: string, purpose: "user" | "admin" = "user") {
  const maxAge = purpose === "admin" ? 1800 : 604800;
  return `hmd_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return "hmd_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}

export { digest };
