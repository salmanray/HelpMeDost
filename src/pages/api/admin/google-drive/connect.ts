import type { APIRoute } from "astro";
import { currentAuth } from "../../../../lib/auth";
import { json } from "../../../../lib/db";
import { driveEnv } from "../../../../lib/google-drive";
const randomState = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,"0")).join("");
export const GET: APIRoute = async (context) => {
  const user = await currentAuth(context);
  if (!user || user.purpose !== "admin" || user.user_type !== "admin") return json({error:"Admin sign-in required."},401);
  const env = driveEnv(context);
  if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_REDIRECT_URI) return json({error:"Google OAuth Client ID or redirect URI is missing."},500);
  const state = randomState();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({client_id:env.GOOGLE_DRIVE_CLIENT_ID,redirect_uri:env.GOOGLE_DRIVE_REDIRECT_URI,response_type:"code",scope:"https://www.googleapis.com/auth/drive.file",access_type:"offline",prompt:"consent",include_granted_scopes:"true",state}).toString();
  return new Response(null,{status:302,headers:{Location:url.toString(),"Set-Cookie":`hmd_drive_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/admin/google-drive; Max-Age=600`,"Cache-Control":"no-store"}});
};
