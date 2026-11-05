const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function razorpayConfig(context: { locals: { runtime?: { env?: Record<string, string | undefined> } } }) {
  const env = context.locals.runtime?.env;
  const keyId = env?.RAZORPAY_KEY_ID;
  const keySecret = env?.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay credentials are not configured.");
  return { keyId, keySecret, webhookSecret: env?.RAZORPAY_WEBHOOK_SECRET };
}

export async function razorpayRequest<T>(path: string, keyId: string, keySecret: string, body?: unknown): Promise<T> {
  const response = await fetch("https://api.razorpay.com/v1" + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: "Basic " + btoa(keyId + ":" + keySecret), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Razorpay API request failed.");
  return data as T;
}
