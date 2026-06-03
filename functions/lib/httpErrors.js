"use strict";
//
// httpErrorStatus — map a thrown error to the correct HTTP status.
//
// Several HTTP functions wrapped auth/validation in a bare try/catch that
// returned 500 for everything, so a missing/invalid token surfaced as a
// 500 instead of 401 (and a bad body as 500 instead of 400). This classifier
// inspects the error shape and returns the right status; callers do:
//
//   } catch (err) {
//     return res.status(httpErrorStatus(err)).json({ error: err.message });
//   }
//
// Recognised shapes:
//   • verifyCaller():            throws Error with { code: 401 }
//   • requireCeo():              throws Error("Forbidden: CEO role required")
//   • admin.auth().verifyIdToken(): throws { code: 'auth/...' } / "...token..."
//   • explicit validation:       Error with { status:400 } / { code:400 }
//
function httpErrorStatus(err) {
  // Explicit numeric code/status set by the thrower wins.
  const numeric = (err && (err.code ?? err.status));
  if (numeric === 401 || numeric === 400 || numeric === 403) return numeric;

  // String sentinel codes used across this codebase: AUTH_MISSING / AUTH_INVALID
  // (index.js verifyAuth) and Firebase's 'auth/...' codes → all unauthenticated.
  if (typeof (err && err.code) === "string" && err.code.toUpperCase().startsWith("AUTH")) return 401;

  const s = String((err && (err.code || err.message)) || "").toLowerCase();

  if (s.includes("forbidden") || s.includes("permission") || s.includes("role required")) return 403;
  if (
    s.includes("auth/") || s.includes("token") || s.includes("unauthor") ||
    s.includes("credential") || s.includes("authorization") || s.includes("id-token")
  ) return 401;
  if (s.includes("required") || s.includes("invalid") || s.includes("must be") || s.includes("bad request")) return 400;

  return 500;
}

module.exports = { httpErrorStatus };
