import type { APIContext } from "astro";

type DriveEnv = {
  GOOGLE_DRIVE_CLIENT_ID?: string;
  GOOGLE_DRIVE_CLIENT_SECRET?: string;
  GOOGLE_DRIVE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_ACTIVE_FOLDER_ID?: string;
  GOOGLE_DRIVE_ARCHIVE_FOLDER_ID?: string;
  GOOGLE_DRIVE_REDIRECT_URI?: string;
};
export function driveEnv(context: APIContext) { return context.locals.runtime?.env as DriveEnv || {}; }
export async function driveAccessToken(env: DriveEnv) {
  if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET || !env.GOOGLE_DRIVE_REFRESH_TOKEN) {
    throw new Error("Google Drive is not connected. Configure the OAuth refresh token in Cloudflare Preview secrets.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_DRIVE_CLIENT_ID, client_secret: env.GOOGLE_DRIVE_CLIENT_SECRET, refresh_token: env.GOOGLE_DRIVE_REFRESH_TOKEN, grant_type: "refresh_token" })
  });
  const data = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Google Drive token refresh failed.");
  return data.access_token;
}
export async function uploadDrivePdf(env: DriveEnv, file: File, title: string) {
  if (!env.GOOGLE_DRIVE_ACTIVE_FOLDER_ID) throw new Error("Active Google Drive folder is not configured.");
  const token = await driveAccessToken(env);
  const metadata = { name: file.name, mimeType: "application/pdf", parents: [env.GOOGLE_DRIVE_ACTIVE_FOLDER_ID], description: title };
  const boundary = "hmd_" + crypto.randomUUID().replaceAll("-", "");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`);
  const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,size,mimeType", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body
  });
  const data = await response.json() as { id?: string; name?: string; webViewLink?: string; size?: string; error?: { message?: string } };
  if (!response.ok || !data.id) throw new Error(data.error?.message || "Google Drive upload failed.");
  const permission = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(data.id)}/permissions?fields=id`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "anyone", role: "reader" })
  });
  if (!permission.ok) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(data.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    throw new Error("PDF uploaded but public-view permission could not be set; upload was rolled back.");
  }
  return { id: data.id, name: data.name || file.name, url: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`, size: Number(data.size || bytes.length) };
}
export async function moveDriveFileToArchive(env: DriveEnv, fileId: string) {
  if (!env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID) throw new Error("Archive Google Drive folder is not configured.");
  const token = await driveAccessToken(env);
  const get = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,parents`, { headers: { Authorization: `Bearer ${token}` } });
  const current = await get.json() as { parents?: string[]; error?: { message?: string } };
  if (!get.ok) throw new Error(current.error?.message || "Could not read Drive file.");
  const params = new URLSearchParams({ addParents: env.GOOGLE_DRIVE_ARCHIVE_FOLDER_ID, fields: "id,parents" });
  if (current.parents?.length) params.set("removeParents", current.parents.join(","));
  const moved = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
  if (!moved.ok) { const error = await moved.json() as { error?: { message?: string } }; throw new Error(error.error?.message || "Could not move PDF to archive folder."); }
}
