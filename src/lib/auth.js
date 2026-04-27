import { signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from "firebase/auth";
import { auth, googleProvider } from "./firebase";

export async function signIn() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOut() {
  await fbSignOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
