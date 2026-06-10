"use strict";

// Employee digital business card (vCard 3.0) — DTLK T9.
//
// Issues the SIGNED-IN employee their own card. The photo is the CANONICAL
// employee photo (employees/{employee_id}.photo_url → Storage
// employee-photos/{employee_id}.{ext}) — never a second photo and never the
// vestigial Firebase Auth photoURL.
//
// Constraints: opt-in (per-action), me-central2 (resize happens here, in-region),
// photo embedded as base64 PHOTO in the .vcf ONLY (never the QR), no public URL
// (bytes are inlined; photo_url is never returned), RoPA register entry.

const admin = require("firebase-admin");
const sharp = require("sharp");
const { COMPANY } = require("./lib/company-legal");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

// ── vCard helpers ────────────────────────────────────────────────
// Escape a free-text vCard value (RFC 2426 §5): backslash, comma, semicolon,
// and newlines are escaped.
function vEsc(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// Fold a single logical line to ≤75 octets using CRLF + single-space
// continuation (RFC 2426 §2.6). Used mainly for the long base64 PHOTO line.
function fold(line) {
  const max = 74;
  if (line.length <= max) return line;
  let out = line.slice(0, max);
  let rest = line.slice(max);
  while (rest.length > 0) {
    out += "\r\n " + rest.slice(0, max - 1);
    rest = rest.slice(max - 1);
  }
  return out;
}

// Best-effort "Last;First" split for the structured N field.
function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function buildVcard(emp, photoB64) {
  const { first, last } = splitName(emp.full_name);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vEsc(last)};${vEsc(first)};;;`,
    `FN:${vEsc(emp.full_name)}`,
    `ORG:${vEsc(COMPANY.legal_name_en)}`,
  ];
  if (emp.job_title) lines.push(`TITLE:${vEsc(emp.job_title)}`);
  if (emp.email) lines.push(`EMAIL;TYPE=WORK:${vEsc(emp.email)}`);
  if (emp.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEsc(emp.phone)}`);
  lines.push(`URL:https://www.${COMPANY.domain}`);
  if (photoB64) {
    lines.push(fold(`PHOTO;ENCODING=b;TYPE=JPEG:${photoB64}`));
  }
  lines.push(`REV:${new Date().toISOString()}`);
  lines.push("END:VCARD");
  return lines.join("\r\n");
}

// ── RoPA register — ensure the employee-photo processing activity exists.
// Idempotent; covers the existing Profile upload too (not card-only).
async function ensureRopaEntry() {
  const ref = db.collection("processing_activities").doc("employee-photo");
  const snap = await ref.get();
  if (snap.exists) return;
  await ref.set({
    activity_id: "employee-photo",
    name: "Employee photograph",
    purpose: "Staff identification and the employee's own digital business card (vCard).",
    legal_basis: "Consent (opt-in) for business-card inclusion; legitimate interest for internal staff identification.",
    data_categories: ["Facial image / photograph"],
    data_subjects: ["Employees"],
    storage_location: "Cloud Storage: employee-photos/{employee_id}.{ext}",
    region: "me-central2",
    controller: COMPANY.legal_name_en,
    recipients: ["The employee themselves, via the downloaded vCard"],
    downstream_uses: [
      "Employee Profile page display (employees.photo_url)",
      "vCard PHOTO embed on the employee digital business card (resized, base64, no public URL)",
    ],
    retention: "Retained for the duration of employment; deleted at offboarding.",
    no_public_url: true,
    created_at: FieldValue.serverTimestamp(),
    created_by: "system:generateBusinessCard",
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// Resolve the caller to their employees record (mirrors the Profile page:
// users/{uid} → employee_id → employees/{employee_id}; email fallback).
async function resolveEmployee(decoded) {
  let userData = null;
  const byUid = await db.collection("users").doc(decoded.uid).get();
  if (byUid.exists) userData = byUid.data();
  else {
    const uq = await db.collection("users").where("email", "==", decoded.email).limit(1).get();
    if (!uq.empty) userData = uq.docs[0].data();
  }
  const employeeId = userData && userData.employee_id;
  let empData = null;
  if (employeeId) {
    const empSnap = await db.collection("employees").doc(employeeId).get();
    if (empSnap.exists) empData = empSnap.data();
  }
  if (!empData) {
    const eq = await db.collection("employees").where("email", "==", decoded.email).limit(1).get();
    if (!eq.empty) empData = eq.docs[0].data();
  }
  if (!empData) return null;
  return {
    full_name: empData.full_name || empData.name || userData?.display_name || "",
    job_title: empData.job_title || empData.title || "",
    email: empData.email || decoded.email,
    phone: empData.phone || "",
    photo_url: empData.photo_url || "",
  };
}

// Fetch the canonical photo (server-side — no browser CORS), resize to ~400px
// JPEG (modest KB), return base64. Returns null on any failure so the card
// still issues without a photo. The photo_url itself is never returned.
async function buildResizedPhotoB64(photoUrl) {
  try {
    const resp = await fetch(photoUrl);
    if (!resp.ok) return null;
    const input = Buffer.from(await resp.arrayBuffer());
    const out = await sharp(input)
      .rotate()                                  // honour EXIF orientation
      .resize(400, 400, { fit: "cover" })
      .jpeg({ quality: 72 })
      .toBuffer();
    return out.toString("base64");
  } catch (e) {
    console.warn("[businessCard] photo resize skipped:", e.message);
    return null;
  }
}

async function generateBusinessCardHandler(req, res, { verifyAuth, ALLOWED_ORIGINS }) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send("");
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const decoded = await verifyAuth(req);
    const includePhoto = req.body && req.body.include_photo === true;

    const emp = await resolveEmployee(decoded);
    if (!emp) return res.status(404).json({ error: "No employee record linked to your account — contact HR." });

    // The QR card is ALWAYS photo-free.
    const vcfQr = buildVcard(emp, null);

    // Opt-in + canonical photo present → embed the resized photo in the .vcf only.
    let photoIncluded = false;
    let vcfFull = vcfQr;
    if (includePhoto && emp.photo_url) {
      const b64 = await buildResizedPhotoB64(emp.photo_url);
      if (b64) {
        vcfFull = buildVcard(emp, b64);
        photoIncluded = true;
        await ensureRopaEntry();   // record the processing activity on first photo embed
      }
    }

    const safeName = (emp.full_name || "datalake-contact").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    return res.status(200).json({
      success: true,
      vcf: vcfFull,                 // downloadable card (with photo if opted-in + available)
      vcf_qr: vcfQr,                // photo-free payload for the QR
      filename: `${safeName}.vcf`,
      has_photo: !!emp.photo_url,   // whether a canonical photo exists to offer
      photo_included: photoIncluded,
    });
  } catch (err) {
    console.error("[businessCard] error:", err);
    if (err.code === "AUTH_MISSING" || err.code === "AUTH_INVALID") return res.status(401).json({ error: err.message });
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

module.exports = { generateBusinessCardHandler };
