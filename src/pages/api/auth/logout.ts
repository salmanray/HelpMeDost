import type { APIRoute } from "astro";
import { getDb, json } from "../../../lib/db";
import { cookieToken, digest, clearSessionCookie } from "../../../lib/auth";
export const POST: APIRoute = async (context) => {
  const token = cookieToken(context);
  if (token) { const sql=getDb(context); await sql`DELETE FROM auth_sessions WHERE token_hash=${await digest(token)}`; }
  return new Response(JSON.stringify({ok:true}),{status:200,headers:{"Content-Type":"application/json","Set-Cookie":clearSessionCookie(),"Cache-Control":"no-store"}});
};
