import type { APIRoute } from "astro";
import { getDb, json, cleanText } from "../../../lib/db";

const allowedStatuses = ["submitted", "under_review", "waiting_for_user", "resolved", "closed"];

function authorised(context: Parameters<APIRoute>[0]) {
  const expected = context.locals.runtime?.env?.ADMIN_ACCESS_KEY;
  const supplied = context.request.headers.get("x-admin-key");
  return Boolean(expected && supplied && supplied === expected);
}

export const GET: APIRoute = async (context) => {
  if (!authorised(context)) return json({ error: "Admin access denied." }, 401);
  try {
    const sql = getDb(context);
    const requests = await sql`SELECT id, reference_code, requester_name, requester_phone, subject, description, status, created_at
      FROM service_requests ORDER BY created_at DESC LIMIT 100`;
    return json({ requests });
  } catch (error) {
    console.error("Admin request list failed", error);
    return json({ error: "Unable to load requests." }, 500);
  }
};

export const PATCH: APIRoute = async (context) => {
  if (!authorised(context)) return json({ error: "Admin access denied." }, 401);
  try {
    const body = await context.request.json();
    const id = cleanText(body.id, 50);
    const status = cleanText(body.status, 40);
    if (!id || !allowedStatuses.includes(status)) return json({ error: "Invalid request update." }, 400);
    const sql = getDb(context);
    const rows = await sql`UPDATE service_requests SET status = ${status}, updated_at = now() WHERE id = ${id}::uuid RETURNING id`;
    if (!rows.length) return json({ error: "Request not found." }, 404);

    try {
      await sql`INSERT INTO audit_events (entity_type, entity_id, action, details) VALUES ('service_request', ${id}::uuid, 'status_updated', jsonb_build_object('status', ${status}))`;
    } catch (auditError) {
      console.error("Request status updated, but audit logging failed", auditError);
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Admin request update failed", error);
    return json({ error: "Unable to update request." }, 500);
  }
};
