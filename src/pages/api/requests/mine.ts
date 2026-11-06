import type { APIRoute } from "astro";
import { currentAuth } from "../../../lib/auth";
import { getDb, json } from "../../../lib/db";

const labels: Record<string, string> = {
  submitted: "Submitted / Open",
  under_review: "Reply & Research",
  assigned: "Assigned",
  in_progress: "Reply & Research",
  waiting_for_user: "Reply Delivered",
  resolved: "Resolved",
  closed: "Closed",
  rejected: "Closed"
};

export const GET: APIRoute = async (context) => {
  try {
    const user = await currentAuth(context);
    if (!user || user.purpose !== "user" || user.user_type !== "public") {
      return json({ error: "Please sign in to view your requests." }, 401);
    }
    const sql = getDb(context);
    const requests = await sql`SELECT reference_code, subject, status, created_at, updated_at
      FROM service_requests
      WHERE requester_id = ${user.id} OR lower(requester_email) = ${user.email.toLowerCase()}
      ORDER BY created_at DESC LIMIT 100`;
    return json({ requests: requests.map(request => ({ ...request, status_label: labels[request.status] || "In progress" })) });
  } catch (error) {
    console.error("User request list failed", error);
    return json({ error: "Unable to load your help requests." }, 500);
  }
};
