import type { APIRoute } from "astro";
import { json } from "../../../lib/db";
import { currentAuth } from "../../../lib/auth";
export const GET: APIRoute = async (context) => {
  try { const user = await currentAuth(context); return user ? json({authenticated:true,user}) : json({authenticated:false},401); }
  catch { return json({error:"Unable to check session."},500); }
};
