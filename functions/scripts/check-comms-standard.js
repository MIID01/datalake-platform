#!/usr/bin/env node
"use strict";

/**
 * check-comms-standard.js — CI guard for the Outbound Communications Standard
 * (DTLK-STD-COMMS-001) and legal-identity integrity. Run: `npm run check:comms`
 * (from functions/). Exits non-zero on any violation.
 *
 * It enforces two things that stop the standard eroding on the next feature:
 *
 *  A. SINGLE SEND PATH — mail-send primitives (getGmailClient, sendEmailRaw,
 *     createTeamsCalendarEvent, gmail.users.messages.send, getGraphToken) may
 *     appear only in the sanctioned transport/gateway libs. Existing direct
 *     callers are GRANDFATHERED in LEGACY_ALLOWLIST (tracked tech-debt). Any NEW
 *     file using a primitive fails the build — that is the ratchet.
 *
 *  B. LEGAL-IDENTITY INTEGRITY — forbidden tokens (the wrong CR 109194773, the
 *     misspellings Rajeeh/Rajeh, the wrong entity name) must not appear anywhere
 *     in source. The correct values live only in company-legal.js.
 */

const fs = require("fs");
const path = require("path");

const FUNCTIONS_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(FUNCTIONS_DIR, "..");

// Libs allowed to contain the low-level send primitives (the sanctioned path).
const ALLOWED_SENDER_FILES = new Set([
  "lib/comms-gateway.js", // the ONLY orchestrating send path
  "lib/gmail.js",         // low-level Gmail transport
  "lib/msgraph.js",       // low-level MS Graph transport
  "lib/ics.js",           // builds .ics MIME (no actual send)
]);

// Pre-existing direct callers, grandfathered. DO NOT ADD TO THIS LIST — migrate
// to the gateway instead. Each entry is debt to fold into sendStandardMessage.
const LEGACY_ALLOWLIST = new Set([
  "backfill.js",
  "authAccountAudit.js",
  "deals.js",
  "finance.js",
  "hireSequence.js",
  "hrEmail.js",
  "index.js",
  "leave.js",
  "offboarding.js",
  "notifications.js",
  "passwordReset.js",
  "projectTimesheetSign.js",
  "sendInterviewCV.js",
  "lib/email.js", // a parallel email helper — fold into the gateway later
]);

const SEND_PRIMITIVES = [
  /\bgetGmailClient\b/,
  /\bsendEmailRaw\b/,
  /\bcreateTeamsCalendarEvent\b/,
  /\bgetGraphToken\b/,
  /\.messages\.send\b/,
];

// Forbidden legal-identity tokens. The correct CR is 1009194773 (with leading
// zero); 109194773 is the wrong one — \b keeps it from matching inside 1009194773.
const FORBIDDEN_TOKENS = [
  { re: /\b109194773\b/, label: "wrong CR 109194773 (correct: 1009194773)" },
  { re: /Rajeeh/i, label: "street misspelling 'Rajeeh' (correct: Rajiyah)" },
  { re: /\bRajeh\b/i, label: "street misspelling 'Rajeh' (correct: Rajiyah)" },
  { re: /Datalake Information Technology/i, label: "wrong entity name 'Datalake Information Technology'" },
];

const CODE_EXT = new Set([".js", ".jsx", ".cjs", ".mjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".firebase"]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (CODE_EXT.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const errors = [];
const warnings = [];

// ── A. Single send path (functions/ only — primitives don't exist in src/) ──
const selfRel = "scripts/check-comms-standard.js";
for (const abs of walk(FUNCTIONS_DIR)) {
  const rel = path.relative(FUNCTIONS_DIR, abs).replace(/\\/g, "/");
  if (rel.startsWith("scripts/")) continue;       // test/CI utilities are exempt
  if (ALLOWED_SENDER_FILES.has(rel)) continue;     // sanctioned transport/gateway libs
  const text = fs.readFileSync(abs, "utf8");
  const hit = SEND_PRIMITIVES.find((re) => re.test(text));
  if (!hit) continue;
  if (LEGACY_ALLOWLIST.has(rel)) {
    warnings.push(`LEGACY direct send (migrate to gateway): ${rel}`);
  } else {
    errors.push(`NEW direct send outside the comms gateway: ${rel} — route it through lib/comms-gateway.js sendStandardMessage().`);
  }
}

// ── B. Legal-identity integrity (repo-wide) ──
for (const abs of walk(REPO_ROOT)) {
  const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, "/");
  if (rel.includes("/scripts/check-comms-standard.js") || rel.endsWith(selfRel)) continue; // don't flag our own token list
  const text = fs.readFileSync(abs, "utf8");
  for (const { re, label } of FORBIDDEN_TOKENS) {
    if (re.test(text)) errors.push(`Forbidden legal-identity token in ${rel}: ${label}`);
  }
}

// ── Report ──
if (warnings.length) {
  console.log(`\n⚠  ${warnings.length} grandfathered direct sender(s) (tracked debt):`);
  for (const w of warnings) console.log("   - " + w);
}
if (errors.length) {
  console.error(`\n✖ Outbound Comms Standard check FAILED (${errors.length}):`);
  for (const e of errors) console.error("   - " + e);
  console.error("");
  process.exit(1);
}
console.log(`\n✓ Outbound Comms Standard check passed (${warnings.length} legacy sender(s) tracked, 0 new violations, 0 identity violations).`);
