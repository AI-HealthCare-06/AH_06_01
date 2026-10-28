import { Capacitor } from "@capacitor/core";
import { supabase } from "./client";

export async function googleLogin() {
  let token: string | undefined, nonce: string | undefined;
  if (Capacitor.isNativePlatform()) {
    const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
    const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
    token = result.credential?.idToken;
    nonce = result.credential?.nonce;
  } else {
    const [{ initializeApp, getApps, getApp }, auth, config] = await Promise.all([
      import("firebase/app"),
      import("firebase/auth"),
      import("../../firebase.config.json"),
    ]);
    const app = getApps().length ? getApp() : initializeApp(config.default);
    const firebaseAuth = auth.getAuth(app);
    await auth.setPersistence(firebaseAuth, auth.inMemoryPersistence);
    const provider = new auth.GoogleAuthProvider();
    nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    const hashed = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce))),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    provider.setCustomParameters({ nonce: hashed, prompt: "select_account" });
    try {
      const result = await auth.signInWithPopup(firebaseAuth, provider);
      token = auth.GoogleAuthProvider.credentialFromResult(result)?.idToken ?? undefined;
    } finally {
      await auth.signOut(firebaseAuth);
    }
  }
  if (!token) throw new Error("GOOGLE_ID_TOKEN_MISSING");
  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token, nonce });
  if (error) throw error;
}
