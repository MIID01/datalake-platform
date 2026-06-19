"use strict";

/**
 * comms-profiles.js — Governed sender-identity registry (DTLK-STD-COMMS-001).
 *
 * THE ONLY place a Datalake outbound sender identity is defined. No function may
 * hardcode "Datalake HR Team" / "hr@datalake.sa" / any From address — they must
 * resolve a profile here through the comms gateway (lib/comms-gateway.js).
 *
 *   From    = `${displayName} <${mailbox}>`
 *   Reply-To = mailbox
 *   footer team label = teamLabel
 *
 * `verified` = the mailbox is a CONFIRMED, licensed, monitored address. The
 * gateway REFUSES to send under an unverified profile (fail-closed). A profile is
 * only flipped to verified:true once its mailbox is proven to exist + be licensed.
 *
 * VERIFICATION STATUS (2026-06-19):
 *   - hr@datalake.sa      ✅ PROVEN — a Teams event was created on this mailbox via
 *                            MS Graph, and it is the live Gmail DWD subject. Real + licensed.
 *   - DPO@datalake.sa     ⚠ UNCONFIRMED from code — needs M365 admin confirmation that the
 *                            mailbox exists and is licensed. Left verified:false (fail-closed).
 *   - finance@datalake.sa ⚠ UNCONFIRMED from code — same. Left verified:false (fail-closed).
 *   To activate finance/compliance sending: confirm the mailbox, then flip verified:true.
 */

const SENDER_PROFILES = {
  hr:         { mailbox: "hr@datalake.sa",      displayName: "Datalake HR",         teamLabel: "HR",         verified: true,  governingDoc: null },
  sales:      { mailbox: "sales@datalake.sa",   displayName: "Datalake Sales",      teamLabel: "Sales",      verified: false, governingDoc: null },
  legal:      { mailbox: "legal@datalake.sa",   displayName: "Datalake Legal",      teamLabel: "Legal",      verified: false, governingDoc: "DTLK-SPEC-CON-001" },
  compliance: { mailbox: "DPO@datalake.sa",     displayName: "Datalake Compliance", teamLabel: "Compliance", verified: false, governingDoc: "DTLK-POL-DBM-001" },
  it:         { mailbox: "it@datalake.sa",      displayName: "Datalake IT",         teamLabel: "IT",         verified: false, governingDoc: null },
  finance:    { mailbox: "finance@datalake.sa", displayName: "Datalake Finance",    teamLabel: "Finance",    verified: false, governingDoc: null },
};

/**
 * Resolve a sender profile by key. Throws (fail-closed) when the key is unknown
 * or the profile is not verified — the gateway must never send under an
 * unconfirmed identity.
 */
function resolveSenderProfile(profileKey) {
  const profile = SENDER_PROFILES[profileKey];
  if (!profile) {
    throw new Error(`Unknown sender profile "${profileKey}". Add it to lib/comms-profiles.js.`);
  }
  if (!profile.verified) {
    throw new Error(
      `Sender profile "${profileKey}" (${profile.mailbox}) is not verified. ` +
      `Confirm the mailbox exists + is licensed, then set verified:true in lib/comms-profiles.js.`
    );
  }
  return { key: profileKey, ...profile };
}

module.exports = { SENDER_PROFILES, resolveSenderProfile };
