import type { APIRoute } from "astro";
import { json } from "../../../lib/db";

type FirebaseConfigEnv = {
  PUBLIC_FIREBASE_API_KEY?: string;
  PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
  PUBLIC_FIREBASE_PROJECT_ID?: string;
  PUBLIC_FIREBASE_APP_ID?: string;
};

export const GET: APIRoute = ({ locals }) => {
  const env = locals.runtime?.env as FirebaseConfigEnv | undefined;
  const config = {
    apiKey: env?.PUBLIC_FIREBASE_API_KEY,
    authDomain: env?.PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env?.PUBLIC_FIREBASE_PROJECT_ID,
    appId: env?.PUBLIC_FIREBASE_APP_ID,
  };

  if (Object.values(config).some(value => !value)) {
    return json({ error: "Firebase web configuration is unavailable. Please contact HelpMeDost support." }, 503);
  }

  return json(config);
};
