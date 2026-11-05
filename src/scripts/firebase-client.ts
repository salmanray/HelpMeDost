import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, sendEmailVerification, sendPasswordResetEmail, updateProfile, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID
};
if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
  throw new Error("Firebase web configuration is missing. Please contact HelpMeDost support.");
}
const app = getApps().length ? getApps()[0] : initializeApp(config);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export async function registerWithEmail(email: string, password: string, name: string) {
  const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(credential.user, { displayName: name.trim() });
  await sendEmailVerification(credential.user);
  return credential.user;
}
export async function loginWithEmail(email: string, password: string) {
  const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
  if (!credential.user.emailVerified) {
    await sendEmailVerification(credential.user);
    throw new Error("Please verify your email using the link we just sent. Check your inbox and spam folder.");
  }
  return credential.user;
}
export async function loginWithGoogle() {
  const credential = await signInWithPopup(auth, googleProvider);
  return credential.user;
}
export async function sendPasswordReset(email: string) {
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
  await signOut(auth);
  await fetch("/api/auth/logout", { method: "POST" });
}
