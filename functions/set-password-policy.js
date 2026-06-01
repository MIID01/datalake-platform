"use strict";
//
// One-time admin script — sets the SERVER-SIDE Firebase Auth password policy.
//
// This is the real enforcement boundary. Firebase rejects any password that
// fails these constraints on confirmPasswordReset() (the in-app /reset-password
// page) and updatePassword() (the Profile "Change Password" form), regardless
// of what the client UI allows. The live checklist in the React app
// (src/lib/password-policy.js) MUST mirror the constraints below.
//
// Run once (re-runnable / idempotent), authenticated as a project owner:
//
//   cd functions
//   gcloud auth application-default login          # if ADC not already set
//   node set-password-policy.js
//
// Requires the Identity Toolkit API to be enabled on datalake-production-sa
// (it is — Firebase Auth uses it). firebase-admin >= 11 exposes
// projectConfigManager(); this repo runs 13.x.

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "datalake-production-sa",
});

// Mirror of src/lib/password-policy.js — keep both in sync.
const PASSWORD_POLICY = {
  enforcementState: "ENFORCE",   // reject non-compliant passwords (vs "OFF")
  // Existing users keep their current password until they next change it; set
  // this to true only if you want to FORCE everyone to reset on next sign-in.
  forceUpgradeOnSignin: false,
  constraints: {
    requireUppercase: true,
    requireLowercase: true,
    requireNumeric: true,
    requireNonAlphanumeric: true,   // special character
    minLength: 12,
    maxLength: 4096,
  },
};

async function setPasswordPolicy() {
  try {
    const updated = await admin
      .auth()
      .projectConfigManager()
      .updateProjectConfig({ passwordPolicyConfig: PASSWORD_POLICY });

    console.log("✅ Password policy applied to datalake-production-sa:");
    console.log(JSON.stringify(updated.passwordPolicyConfig, null, 2));
    process.exit(0);
  } catch (e) {
    console.error("❌ Failed to set password policy:");
    console.error(e);
    process.exit(1);
  }
}

setPasswordPolicy();
