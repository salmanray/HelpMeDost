import { initializeApp, getApps } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, sendEmailVerification, sendPasswordResetEmail, updateProfile, signOut
} from "firebase/auth";
import type { Auth } from "firebase/auth";

type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

let authPromise: Promise<Auth> | undefined;

export async function getFirebaseAuth(): Promise<Auth> {
  if (!authPromise) {
    authPromise = (async () => {
      const response = await fetch("/api/auth/firebase-config", { cache: "no-store" });
      const config = await response.json().catch(() => ({})) as Partial<FirebaseWebConfig> & { error?: string };
      if (!response.ok) throw new Error(config.error || "Firebase web configuration is unavailable.");
      if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
        throw new Error("Firebase web configuration is incomplete. Please contact HelpMeDost support.");
      }
      const app = getApps()[0] || initializeApp(config as FirebaseWebConfig);
      return getAuth(app);
    })().catch(error => {
      authPromise = undefined;
      throw error;
    });
  }
  return authPromise;
}

export async function registerWithEmail(email: string, password: string, name: string) {
  const auth = await getFirebaseAuth();
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(credential.user, { displayName: name.trim() });
  await sendEmailVerification(credential.user);
  return credential.user;
}
export async function loginWithEmail(email: string, password: string) {
  const auth = await getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  if (!credential.user.emailVerified) {
    await sendEmailVerification(credential.user);
    throw new Error("Please verify your email using the link we just sent. Check your inbox and spam folder.");
  }
  return credential.user;
}
export async function loginWithGoogle() {
  const auth = await getFirebaseAuth();
  const credential = await signInWithPopup(auth, new GoogleAuthProvider());
  return credential.user;
}
export async function sendPasswordReset(email: string) {
  const auth = await getFirebaseAuth();
  await sendPasswordResetEmail(auth, email.trim());
}
export async function finishHelpMeDostSession(user: { getIdToken: () => Promise<string> }, details: {
  name?: string; mobile?: string; mode?: "register" | "login"; purpose?: "user" | "admin";
} = {}) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/api/auth/firebase-session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, ...details })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to create your HelpMeDost session.");
  window.location.assign(data.redirectTo || "/account");
}
export async function logoutFirebase() {
  const auth = await getFirebaseAuth();
  await signOut(auth);
  await fetch("/api/auth/logout", { method: "POST" });
}
