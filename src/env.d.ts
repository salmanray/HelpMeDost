/// <reference types="astro/client" />

type RuntimeEnv = {
  DATABASE_URL?: string;
  ADMIN_ACCESS_KEY?: string;
  APP_NAME?: string;
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