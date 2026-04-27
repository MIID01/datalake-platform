import { useState, useEffect } from "react";
import { auth, db } from "../lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";

export function useAccessProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
          // User not in RBAC system yet — fallback to email-based detection
          const email = user.email || "";
          let fallbackRole = "engineer";
          if (email === "m.alqumri@datalake.sa") fallbackRole = "ceo";
          else if (email.includes("cto")) fallbackRole = "cto";
          else if (email.includes("hr")) fallbackRole = "hr";

          setProfile({
            uid: user.uid,
            email: user.email,
            role_id: fallbackRole,
            role_name: fallbackRole.toUpperCase(),
            permitted_classes: {},
            client_id: null,
            assigned_projects: [],
            _fallback: true,
          });
          setLoading(false);
          return;
        }

        const userData = userDoc.data();
        const matrixDoc = await getDoc(doc(db, "access_matrix", userData.role_id));
        const roleDoc = await getDoc(doc(db, "roles", userData.role_id));

        setProfile({
          uid: user.uid,
          email: user.email,
          role_id: userData.role_id,
          role_name: roleDoc.exists() ? roleDoc.data().role_name : userData.role_id,
          permitted_classes: matrixDoc.exists() ? matrixDoc.data().data_classes : {},
          client_id: userData.client_id || null,
          assigned_projects: userData.assigned_projects || [],
        });
        setLoading(false);
      } catch (err) {
        console.warn("useAccessProfile error:", err.message);
        setError(err.message);
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const canRead = (dataClass) => {
    if (!profile) return false;
    if (profile._fallback && profile.role_id === "ceo") return true;
    return profile.permitted_classes?.[dataClass] === "read";
  };

  return { profile, loading, error, canRead };
}
