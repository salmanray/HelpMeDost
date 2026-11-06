/// <reference types="astro/client" />

type RuntimeEnv = {
  DATABASE_URL?: string;
  ADMIN_ACCESS_KEY?: string;
  APP_NAME?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  PUBLIC_FIREBASE_API_KEY?: string;
  PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  PUBLIC_FIREBASE_PROJECT_ID?: string;
  PUBLIC_FIREBASE_APP_ID?: string;
};

declare namespace App {
  interface Locals {
    runtime: {
      env: RuntimeEnv;
      cf: unknown;
      caches: unknown;
    };
  }
}
