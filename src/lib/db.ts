import { neon } from "@neondatabase/serverless";
import type { APIContext } from "astro";

export function getDb(context: APIContext) {
  const connectionString = context.locals.runtime?.env?.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  return neon(connectionString);
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export function cleanText(value: unknown, max = 2000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
