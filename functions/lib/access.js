const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/**
 * Resolve a Firebase Auth user to their full access profile.
 * Throws if user record missing or disabled.
 */
async function getUserAccessProfile(uid) {
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) throw new Error("User record not found");

  const userData = userDoc.data();
  if (userData.status !== "active") throw new Error("User is disabled");

  const matrixDoc = await db.collection("access_matrix").doc(userData.role_id).get();
  if (!matrixDoc.exists) throw new Error(`Access matrix for role ${userData.role_id} not found`);

  const roleDoc = await db.collection("roles").doc(userData.role_id).get();

  return {
    uid,
    email: userData.email,
    display_name: userData.display_name,
    role_id: userData.role_id,
    role_name: roleDoc.exists ? roleDoc.data().role_name : userData.role_id,
    permitted_classes: matrixDoc.data().data_classes,
    client_id: userData.client_id || null,
    assigned_projects: userData.assigned_projects || [],
  };
}

/** Check if a user can read a specific data class. */
function canRead(profile, dataClass) {
  return profile.permitted_classes[dataClass] === "read";
}

/**
 * Filter an object to only include keys the role can read.
 * fieldDataClassMap: { responseField: dataClassName }
 */
function filterByAccess(obj, fieldDataClassMap, profile) {
  const result = {};
  for (const [field, dataClass] of Object.entries(fieldDataClassMap)) {
    if (canRead(profile, dataClass)) {
      result[field] = obj[field];
    }
    // Architectural exclusion: field never included if not readable
  }
  return result;
}

/** Log access events to task_audit_log. */
async function logAccessEvent(eventType, profile, details) {
  await db.collection("task_audit_log").add({
    event: eventType,
    action_by: profile.email,
    action_at: admin.firestore.FieldValue.serverTimestamp(),
    role_id: profile.role_id,
    details,
    ip_address: details.ip_address || "unknown",
  });
}

module.exports = { getUserAccessProfile, canRead, filterByAccess, logAccessEvent };
