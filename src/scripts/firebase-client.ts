import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  updateProfile,
  signOut,
  type User,
} from "firebase/auth";

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

function assertFirebaseConfig() {
  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    throw new Error(
      "Firebase web configuration is missing. Set PUBLIC_FIREBASE_API_KEY, PUBLIC_FIREBASE_AUTH_DOMAIN, PUBLIC_FIREBASE_PROJECT_ID and PUBLIC_FIREBASE_APP_ID as Cloudflare Pages build variables, then redeploy."
    );
  }
}

assertFirebaseConfig();

const app = getApps().length ? getApps()[0] : initializeApp(config);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

/** Map common Firebase Auth errors to clear, actionable messages. */
export function friendlyAuthError(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: string }).code || "")
      : "";
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";

  if (code === "auth/unauthorized-domain" || message.includes("unauthorized-domain")) {
    return "This site domain is not authorised in Firebase. Add the current hostname (for example helpmedost.pages.dev or helpmedost.in) under Firebase Authentication → Settings → Authorised domains, then try again.";
  }
  if (code === "auth/popup-blocked") {
    return "The Google sign-in popup was blocked by your browser. Allow popups for this site and try again.";
  }
  if (code === "auth/popup-closed-by-user") {
    return "Google sign-in was cancelled. Please try again.";
  }
  if (code === "auth/cancelled-popup-request") {
    return "Another sign-in popup is already open. Close it and try again.";
  }
  if (code === "auth/network-request-failed") {
    return "Network error while contacting Google or Firebase. Check your connection and try again.";
  }
  if (code === "auth/user-disabled") {
    return "This account has been disabled. Contact HelpMeDost support.";
  }
  if (code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/user-not-found") {
    return "Incorrect email or password.";
  }
  if (code === "auth/email-already-in-use") {
    return "An account already exists with this email. Sign in instead, or use Google if you registered that way.";
  }
  if (code === "auth/weak-password") {
    return "Password is too weak. Use at least 6 characters.";
  }
  if (code === "auth/invalid-email") {
    return "Please enter a valid email address.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (message) return message;
  return "Sign-in failed. Please try again.";
}

export async function registerWithEmail(email: string, password: string, name: string) {
  try {
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(credential.user, { displayName: name.trim() });
    await sendEmailVerification(credential.user);
    return credential.user;
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

export async function loginWithEmail(email: string, password: string) {
  try {
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user);
      throw new Error(
        "Please verify your email using the link we just sent. Check your inbox and spam folder."
      );
    }
    return credential.user;
  } catch (error) {
    if (error instanceof Error && error.message.includes("verify your email")) throw error;
    throw new Error(friendlyAuthError(error));
  }
}

export async function loginWithGoogle(): Promise<User> {
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    return credential.user;
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

export async function sendPasswordReset(email: string) {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (error) {
    throw new Error(friendlyAuthError(error));
  }
}

export async function finishHelpMeDostSession(
  user: { getIdToken: (forceRefresh?: boolean) => Promise<string> },
  details: {
    name?: string;
    mobile?: string;
    mode?: "register" | "login";
    purpose?: "user" | "admin";
  } = {}
) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/api/auth/firebase-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, ...details }),
  });
  let data: { error?: string; redirectTo?: string } = {};
  try {
    data = await response.json();
  } catch {
    /* non-JSON error body */
  }
  if (!response.ok) {
    throw new Error(data.error || "Unable to create your HelpMeDost session.");
  }
  window.location.assign(data.redirectTo || "/account");
}

export async function logoutFirebase() {
  try {
    await signOut(auth);
  } catch {
    /* still clear server session */
  }
  await fetch("/api/auth/logout", { method: "POST" });
}
