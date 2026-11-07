import type { APIContext } from "astro";

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string | ArrayBuffer | Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const rawData = typeof message === "string"
    ? encoder.encode(message)
    : message instanceof Uint8Array
      ? message
      : new Uint8Array(message);
  const data = new Uint8Array(rawData.byteLength);
  data.set(rawData);
  const signature = await crypto.subtle.sign("HMAC", key, data.buffer);
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function razorpayConfig(context: APIContext) {
  const env = context.locals.runtime?.env;
  // Cloudflare dashboard copy/paste can leave surrounding whitespace in secrets.
  const keyId = env?.RAZORPAY_KEY_ID?.trim();
  const keySecret = env?.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) throw new Error("Razorpay credentials are not configured.");
  return { keyId, keySecret, webhookSecret: env?.RAZORPAY_WEBHOOK_SECRET?.trim() };
}

export async function razorpayRequest<T>(path: string, keyId: string, keySecret: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch("https://api.razorpay.com/v1" + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: "Basic " + btoa(keyId.trim() + ":" + keySecret.trim()), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch (error) {
    console.error("Razorpay network request failed", { path, error: error instanceof Error ? error.message : "Unknown network error" });
    throw new Error("Razorpay could not be reached. Check the payment gateway connection.");
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    // Keep gateway diagnostics in server logs only; never return credentials or raw payloads to the browser.
    const gatewayCode = typeof data?.error?.code === "string" ? data.error.code : "UNKNOWN";
    const gatewayDescription = typeof data?.error?.description === "string"
      ? data.error.description.slice(0, 240)
      : "No error description returned";
    console.error("Razorpay API rejected request", {
      path,
      httpStatus: response.status,
      gatewayCode,
      gatewayDescription
    });
    throw new Error(`Razorpay rejected the request (HTTP ${response.status}, ${gatewayCode}): ${gatewayDescription}`);
  }

  if (!data || typeof data !== "object") throw new Error("Razorpay returned an invalid response.");
  return data as T;
}
