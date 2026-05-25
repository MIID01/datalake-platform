import { signInWithPopup, signInWithEmailAndPassword, sendPasswordResetEmail, signOut as firebaseSignOut, onAuthStateChanged } from "firebase/auth";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "./firebase";

// Hardcoded CEO account — always granted the CEO role regardless of Firestore.
export const CEO_EMAIL = "m.alqumri@datalake.sa";

export async function signIn() {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

// Email/password sign-in (for accounts provisioned with a password by IT Admin).
export async function signInWithEmail(email, password) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  return result.user;
}

// Send a password-reset email so users can set/recover their password.
export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function signOut() {
  await firebaseSignOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Resolve a signed-in user's role record using the same precedence as AuthGate:
 *   1. UID-keyed users doc (legacy)
 *   2. users collection queried by email
 *   3. CEO / HR email fallbacks
 * Returns the user record (with `role_id`) or null when no role can be resolved.
 */
export async function resolveUserRole(uid, email) {
  if (!email) return null;
  try {
    const uidSnap = await getDoc(doc(db, "users", uid));
    if (uidSnap.exists()) return uidSnap.data();

    const q = query(collection(db, "users"), where("email", "==", email));
    const snap = await getDocs(q);
    if (!snap.empty) return snap.docs[0].data();
  } catch (err) {
    console.warn("resolveUserRole error:", err.message);
  }

  if (email === CEO_EMAIL) {
    return { role_id: "ceo", status: "active", display_name: "CEO", email };
  }
  if (email.toLowerCase() === "hr@datalake.sa") {
    return { role_id: "hr", status: "active", display_name: "HR Admin", email };
  }
  return null;
}
