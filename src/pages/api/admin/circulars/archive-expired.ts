import type { APIRoute } from "astro";
import { currentAuth } from "../../../../lib/auth";
import { getDb, json } from "../../../../lib/db";
import { driveEnv, moveDriveFileToArchive } from "../../../../lib/google-drive";
export const POST: APIRoute = async (context) => {
  const user=await currentAuth(context);
  if(!user || user.purpose!=="admin" || user.user_type!=="admin")return json({error:"Admin sign-in required."},401);
  try{
    const sql=getDb(context);
    const expired=await sql`SELECT id,active_object_key FROM circular_notifications WHERE status='published' AND expires_at IS NOT NULL AND expires_at<=now() ORDER BY expires_at ASC LIMIT 100`;
    const results:{id:string;ok:boolean;error?:string}[]=[];
    for(const item of expired){
      try{
        if(item.active_object_key)await moveDriveFileToArchive(driveEnv(context),item.active_object_key);
        await sql`UPDATE circular_notifications SET status='archived',archive_object_key=active_object_key,archived_at=now(),updated_at=now() WHERE id=${item.id}::uuid AND status='published' AND expires_at<=now()`;
        results.push({id:item.id,ok:true});
      }catch(error){results.push({id:item.id,ok:false,error:error instanceof Error?error.message:"Archive failed"});}
    }
    return json({ok:true,processed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results});
  }catch(error){console.error("Expiry archive job failed",error);return json({error:"Unable to process expired circulars."},500);}
};
