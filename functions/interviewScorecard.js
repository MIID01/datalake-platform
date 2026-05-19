/**
 * Interview Scorecard Cloud Functions
 *
 * getClientScorecardForm  — public, token-gated, returns scorecard form schema
 * submitClientScorecard   — public, token-gated, writes client scores
 * getCandidateInterviewSummary — CEO-only, returns combined HR + client scores
 *
 * Firestore collections:
 *   interview_scorecards — one doc per candidate+project scorecard
 *   scorecard_tokens     — one-time tokens for client access
 *
 * DTLK-ADR-002
 */

const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

const db = admin.firestore();

// ── Scorecard question categories ──
const SCORECARD_SCHEMA = {
  version: "1.0",
  categories: [
    {
      id: "technical",
      title: "Technical Competency",
      questions: [
        { id: "tech_depth", label: "Depth of technical knowledge in relevant domain", type: "rating", max: 5 },
        { id: "tech_problem", label: "Problem-solving approach and analytical thinking", type: "rating", max: 5 },
        { id: "tech_tools", label: "Proficiency with required tools and technologies", type: "rating", max: 5 },
      ],
    },
    {
      id: "communication",
      title: "Communication & Professionalism",
      questions: [
        { id: "comm_clarity", label: "Clarity of communication", type: "rating", max: 5 },
        { id: "comm_english", label: "English language proficiency", type: "rating", max: 5 },
        { id: "comm_professional", label: "Professional presentation and demeanour", type: "rating", max: 5 },
      ],
    },
    {
      id: "experience",
      title: "Relevant Experience",
      questions: [
        { id: "exp_relevance", label: "Relevance of past experience to this role", type: "rating", max: 5 },
        { id: "exp_examples", label: "Quality of examples and case studies provided", type: "rating", max: 5 },
        { id: "exp_impact", label: "Demonstrated business impact in previous roles", type: "rating", max: 5 },
      ],
    },
    {
      id: "cultural",
      title: "Cultural Fit & Availability",
      questions: [
        { id: "cult_team", label: "Team collaboration and interpersonal skills", type: "rating", max: 5 },
        { id: "cult_adapt", label: "Adaptability and willingness to learn", type: "rating", max: 5 },
        { id: "cult_avail", label: "Availability and start date alignment", type: "rating", max: 5 },
      ],
    },
  ],
  additional_fields: [
    { id: "overall_recommendation", label: "Overall Recommendation", type: "select", options: ["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"] },
    { id: "strengths", label: "Key Strengths", type: "textarea" },
    { id: "concerns", label: "Key Concerns", type: "textarea" },
    { id: "notes", label: "Additional Notes", type: "textarea" },
  ],
};

/**
 * Generate a one-time scorecard token for a candidate + project.
 * Called internally by sendInterviewCV after email is sent.
 */
async function generateScorecardToken(candidateId, projectId, clientEmail, clientName) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

  await db.collection("scorecard_tokens").doc(token).set({
    candidate_id: candidateId,
    project_id: projectId,
    client_email: clientEmail,
    client_name: clientName,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    expires_at: admin.firestore.Timestamp.fromDate(expiresAt),
    used: false,
    used_at: null,
  });

  return token;
}

/**
 * getClientScorecardForm — public endpoint, token-gated
 * GET ?token=xxx
 * Returns: scorecard form schema + candidate/project summary (no PII beyond name)
 */
async function getClientScorecardFormHandler(req, res, { ALLOWED_ORIGINS }) {
  // CORS
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "*"); // Public endpoint
  }
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "Token is required" });

    // Validate token
    const tokenDoc = await db.collection("scorecard_tokens").doc(token).get();
    if (!tokenDoc.exists) {
      return res.status(404).json({ error: "Invalid or expired scorecard link" });
    }

    const tokenData = tokenDoc.data();

    // Check expiry
    if (tokenData.expires_at && tokenData.expires_at.toDate() < new Date()) {
      return res.status(410).json({ error: "This scorecard link has expired" });
    }

    // Check if already used
    if (tokenData.used) {
      return res.status(409).json({ error: "This scorecard has already been submitted" });
    }

    // Load candidate (minimal PII — name and role only)
    const candidateDoc = await db.collection("talent_pool").doc(tokenData.candidate_id).get();
    const candidate = candidateDoc.exists ? candidateDoc.data() : {};

    // Load project
    const projectDoc = await db.collection("projects").doc(tokenData.project_id).get();
    const project = projectDoc.exists ? projectDoc.data() : {};

    return res.status(200).json({
      schema: SCORECARD_SCHEMA,
      candidate_summary: {
        name: candidate.full_name || "Candidate",
        role: candidate.role_interest || "Engineering Consultant",
      },
      project_summary: {
        name: project.project_name || "Project",
        client: project.client_name || "Client",
      },
      client_name: tokenData.client_name,
      token_valid: true,
    });
  } catch (err) {
    console.error("getClientScorecardForm error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * submitClientScorecard — public endpoint, token-gated
 * POST { token, scores: {...}, recommendation, strengths, concerns, notes }
 */
async function submitClientScorecardHandler(req, res, { ALLOWED_ORIGINS }) {
  // CORS
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "*");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { token, scores, overall_recommendation, strengths, concerns, notes } = req.body;

    if (!token) return res.status(400).json({ error: "Token is required" });
    if (!scores || typeof scores !== "object") return res.status(400).json({ error: "Scores are required" });
    if (!overall_recommendation) return res.status(400).json({ error: "Overall recommendation is required" });

    // Validate token
    const tokenRef = db.collection("scorecard_tokens").doc(token);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists) {
      return res.status(404).json({ error: "Invalid or expired scorecard link" });
    }

    const tokenData = tokenDoc.data();

    if (tokenData.expires_at && tokenData.expires_at.toDate() < new Date()) {
      return res.status(410).json({ error: "This scorecard link has expired" });
    }

    if (tokenData.used) {
      return res.status(409).json({ error: "This scorecard has already been submitted" });
    }

    // Validate recommendation value
    const validRecommendations = ["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"];
    if (!validRecommendations.includes(overall_recommendation)) {
      return res.status(400).json({ error: "Invalid recommendation value" });
    }

    // Calculate average score
    const scoreValues = Object.values(scores).filter(v => typeof v === "number" && v >= 1 && v <= 5);
    const avgScore = scoreValues.length > 0
      ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 100) / 100
      : null;

    const now = admin.firestore.FieldValue.serverTimestamp();

    // Write scorecard
    const scorecardId = `${tokenData.candidate_id}_${tokenData.project_id}`;
    await db.collection("interview_scorecards").doc(scorecardId).set({
      candidate_id: tokenData.candidate_id,
      project_id: tokenData.project_id,
      client_email: tokenData.client_email,
      client_name: tokenData.client_name,
      scores,
      average_score: avgScore,
      overall_recommendation,
      strengths: strengths || "",
      concerns: concerns || "",
      notes: notes || "",
      submitted_at: now,
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
      schema_version: SCORECARD_SCHEMA.version,
    });

    // Mark token as used
    await tokenRef.update({
      used: true,
      used_at: now,
    });

    // Update talent_pool with scorecard reference
    await db.collection("talent_pool").doc(tokenData.candidate_id).update({
      client_scorecard_id: scorecardId,
      client_scorecard_submitted_at: now,
      client_recommendation: overall_recommendation,
      client_avg_score: avgScore,
    });

    // Audit log
    await db.collection("task_audit_log").add({
      event: "CLIENT_SCORECARD_SUBMITTED",
      action_by: tokenData.client_email,
      action_at: now,
      details: {
        candidate_id: tokenData.candidate_id,
        project_id: tokenData.project_id,
        recommendation: overall_recommendation,
        average_score: avgScore,
        client_name: tokenData.client_name,
      },
      ip_address: req.ip || req.headers["x-forwarded-for"] || "unknown",
    });

    // BigQuery audit (non-blocking)
    try {
      const { writeBigQueryAudit } = require("./prepareInterviewCV");
      await writeBigQueryAudit({
        event_type: "CLIENT_SCORECARD_SUBMITTED",
        actor: tokenData.client_email,
        candidate_id: tokenData.candidate_id,
        project_id: tokenData.project_id,
        pdpl_consent_verified: true,
        regulatory_basis: "PDPL Art. 4, 5",
      });
    } catch (_) { /* non-blocking */ }

    return res.status(200).json({
      success: true,
      message: "Thank you. Your scorecard has been submitted successfully.",
      scorecard_id: scorecardId,
    });
  } catch (err) {
    console.error("submitClientScorecard error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * getCandidateInterviewSummary — CEO-only
 * GET ?candidate_id=xxx&project_id=yyy
 * Returns: combined HR scores + client scorecard + recommendation
 */
async function getCandidateInterviewSummaryHandler(req, res, { verifyAuth, getUserAccessProfile, ALLOWED_ORIGINS }) {
  // CORS
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS.includes(req.headers.origin) ? req.headers.origin : "");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.set("Access-Control-Max-Age", "3600");
    return res.status(204).send("");
  }

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    // CEO only
    const decoded = await verifyAuth(req);
    const profile = await getUserAccessProfile(decoded.uid);
    if (profile.role_id !== "ceo") {
      return res.status(403).json({ error: "CEO role required to view interview summaries" });
    }

    const { candidate_id, project_id } = req.query;
    if (!candidate_id) return res.status(400).json({ error: "candidate_id is required" });

    // Load candidate
    const candidateDoc = await db.collection("talent_pool").doc(candidate_id).get();
    if (!candidateDoc.exists) return res.status(404).json({ error: "Candidate not found" });
    const candidate = candidateDoc.data();

    // Load HR scoring data
    const hrData = {
      hr_score: candidate.hr_score || null,
      hr_passed: candidate.hr_passed || null,
      hr_hard_fail: candidate.hr_hard_fail || false,
      hr_hard_fail_reason: candidate.hr_hard_fail_reason || null,
      hr_evaluated_by: candidate.hr_evaluated_by || null,
      hr_evaluated_at: candidate.hr_evaluated_at || null,
      scoring_stage: candidate.scoring_stage || null,
    };

    // Load client scorecard
    let clientScorecard = null;
    const scorecardId = project_id
      ? `${candidate_id}_${project_id}`
      : candidate.client_scorecard_id;

    if (scorecardId) {
      const scorecardDoc = await db.collection("interview_scorecards").doc(scorecardId).get();
      if (scorecardDoc.exists) {
        clientScorecard = scorecardDoc.data();
      }
    }

    // Build combined assessment
    const assessment = {
      candidate: {
        id: candidate_id,
        name: candidate.full_name,
        role: candidate.role_interest,
        state: candidate.state,
      },
      hr_assessment: hrData,
      client_assessment: clientScorecard ? {
        scores: clientScorecard.scores,
        average_score: clientScorecard.average_score,
        recommendation: clientScorecard.overall_recommendation,
        strengths: clientScorecard.strengths,
        concerns: clientScorecard.concerns,
        notes: clientScorecard.notes,
        submitted_by: clientScorecard.client_name,
        submitted_at: clientScorecard.submitted_at,
      } : null,
      hire_ready: !!(
        hrData.hr_passed === true &&
        clientScorecard &&
        ["STRONG_HIRE", "HIRE"].includes(clientScorecard.overall_recommendation)
      ),
    };

    return res.status(200).json(assessment);
  } catch (err) {
    console.error("getCandidateInterviewSummary error:", err);
    return res.status(500).json({ error: "Internal server error", detail: err.message });
  }
}

module.exports = {
  getClientScorecardFormHandler,
  submitClientScorecardHandler,
  getCandidateInterviewSummaryHandler,
  generateScorecardToken,
  SCORECARD_SCHEMA,
};
