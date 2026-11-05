/// <reference types="astro/client" />

type RuntimeEnv = {
  DATABASE_URL?: string;
  /** @deprecated Prefer Firebase admin allowlist via ADMIN_EMAILS. Kept for main-branch compatibility until fully removed. */
  ADMIN_ACCESS_KEY?: string;
  APP_NAME?: string;
  /** Firebase Web API key (same as PUBLIC_FIREBASE_API_KEY). Used server-side for Identity Toolkit token lookup. */
  FIREBASE_API_KEY?: string;
  /** Firebase project ID, e.g. helpmedost-auth-test */
  FIREBASE_PROJECT_ID?: string;
  /** Comma-separated allowlist of admin emails (lowercase). Example: mr.ray.rs@gmail.com */
  ADMIN_EMAILS?: string;
};

interface ImportMetaEnv {
  readonly PUBLIC_FIREBASE_API_KEY?: string;
  readonly PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  readonly PUBLIC_FIREBASE_PROJECT_ID?: string;
  readonly PUBLIC_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: RuntimeEnv;
      cf: unknown;
      caches: unknown;
    };
  }
}
