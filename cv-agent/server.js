/**
 * datalake-cv-agent — Cloud Run Service
 *
 * POST /reformat
 *   Accepts: multipart form — cv_file (PDF), jd_file (text)
 *   Returns: DOCX (application/vnd.openxmlformats-officedocument.wordprocessingml.document)
 *
 * Pipeline:
 *   1. Extract text from PDF via pdf-parse
 *   2. Call Vertex AI Gemini (me-central2) to reformat into structured JSON
 *   3. Build DOCX using the Datalake Skills Portfolio template
 *   4. Return DOCX buffer
 *
 * Sovereignty: Vertex AI endpoint is me-central2 only. No external AI services.
 * PDPL: This service processes data that has already been consent-verified by the
 *        calling Cloud Function. No additional consent check here — that is the
 *        responsibility of prepareInterviewCV.
 *
 * DTLK-FORM-HR-CV-002-v2
 */

const express = require("express");
const multer = require("multer");
const { GoogleGenAI } = require("@google/genai");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, BorderStyle,
  AlignmentType, ShadingType, TabStopPosition, TabStopType,
} = require("docx");

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ── Vertex AI setup (me-central2 ONLY) ──
const PROJECT_ID = process.env.GCP_PROJECT || "datalake-production-sa";
const LOCATION = "me-central2";
const MODEL = "gemini-2.5-flash";

const ai = new GoogleGenAI({ project: PROJECT_ID, location: LOCATION });

// ── Health check ──
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "datalake-cv-agent", region: LOCATION, model: MODEL });
});

// ── Main endpoint ──
app.post("/reformat", upload.fields([
  { name: "cv_file", maxCount: 1 },
  { name: "jd_file", maxCount: 1 },
]), async (req, res) => {
  const startTime = Date.now();

  try {
    // 1. Validate inputs
    if (!req.files?.cv_file?.[0]) {
      return res.status(400).json({ error: "cv_file is required" });
    }

    const cvBuffer = req.files.cv_file[0].buffer;
    const jdBuffer = req.files.jd_file?.[0]?.buffer;
    const jdText = jdBuffer ? jdBuffer.toString("utf-8") : "";

    // 2. Pass PDF directly to Gemini for native extraction and OCR
    const structuredData = await extractWithVertexAI(cvBuffer, jdText);

    // 4. Build DOCX
    const docxBuffer = await buildDatalakePortfolioDocx(structuredData);

    // 5. Return DOCX
    const elapsed = Date.now() - startTime;
    console.log(`CV reformatted in ${elapsed}ms — ${structuredData.full_name}`);

    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.set("Content-Disposition", `attachment; filename="DTLK-FORM-HR-CV-002-v2_${(structuredData.full_name || "candidate").replace(/\s+/g, "_")}.docx"`);
    res.send(docxBuffer);
  } catch (err) {
    console.error("Reformat error:", err);
    res.status(500).json({ error: "Internal server error", detail: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════
// VERTEX AI — Structured extraction
// ═══════════════════════════════════════════════════════════════════
async function extractWithVertexAI(cvBuffer, jdText) {
  const prompt = `You are a professional HR document formatter for Datalake Information Technology, a Saudi Arabian IT outsourcing company.

Your task: Extract structured candidate information from the attached raw CV (PDF) and reformat it for the Datalake Skills Portfolio template.
The PDF may be scanned; use your OCR capabilities to read all text accurately.

IMPORTANT RULES:
- Extract ONLY information explicitly present in the CV. Do NOT invent or guess.
- For any field not found in the CV, use null.
- Skills must be actual technologies/tools mentioned, not generic descriptions.
- Experience entries must have real company names and dates from the CV.
- Certifications must be real certifications mentioned in the CV.
- Education must be real degrees and institutions from the CV.
- The professional_summary should be 3-5 sentences summarizing the candidate's profile.

${jdText ? `\nJOB DESCRIPTION CONTEXT (use to emphasize relevant skills):\n${jdText}\n` : ""}

Return a JSON object with this exact schema:
{
  "full_name": "string",
  "title": "string — current professional title",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "linkedin_url": "string or null",
  "professional_summary": "string — 3-5 sentence professional summary",
  "years_of_experience": "string — e.g. '10+ years'",
  "core_skills": ["string array — key technical skills"],
  "certifications": [
    { "name": "string", "issuer": "string or null", "year": "string or null" }
  ],
  "education": [
    { "degree": "string", "institution": "string", "year": "string or null", "field": "string or null" }
  ],
  "experience": [
    {
      "company": "string",
      "role": "string",
      "period": "string — e.g. 'Jan 2020 - Present'",
      "location": "string or null",
      "highlights": ["string array — 3-5 key achievements/responsibilities"]
    }
  ],
  "languages": [
    { "language": "string", "proficiency": "string — e.g. 'Native', 'Fluent', 'Professional'" }
  ]
}`;

  const result = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { role: "user", parts: [
        { text: prompt },
        { inlineData: { data: cvBuffer.toString("base64"), mimeType: "application/pdf" } }
      ]}
    ],
    config: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    }
  });

  const responseText = result.text;

  try {
    return JSON.parse(responseText);
  } catch (parseErr) {
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }
    throw new Error("Vertex AI returned non-JSON response: " + responseText.slice(0, 200));
  }
}

// ═══════════════════════════════════════════════════════════════════
// DOCX Builder — Datalake Skills Portfolio Template
// ═══════════════════════════════════════════════════════════════════
const BRAND = {
  navy: "022873",
  sky: "1598CC",
  orange: "EF5829",
  white: "FFFFFF",
  lightGray: "F8F9FA",
  darkGray: "333333",
  medGray: "666666",
};

async function buildDatalakePortfolioDocx(data) {
  const sections = [];

  // ── Header Section ──
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: "DATALAKE", font: "Calibri", size: 36, bold: true, color: BRAND.navy }),
        new TextRun({ text: " INFORMATION TECHNOLOGY", font: "Calibri", size: 36, color: BRAND.sky }),
      ],
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Skills Portfolio", font: "Calibri", size: 24, color: BRAND.medGray, italics: true }),
        new TextRun({ text: "  ·  DTLK-FORM-HR-CV-002-v2", font: "Calibri", size: 16, color: BRAND.medGray }),
      ],
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BRAND.sky } },
    })
  );

  // ── Candidate Header ──
  sections.push(
    new Paragraph({
      text: data.full_name || "Candidate",
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 60 },
      run: { font: "Calibri", size: 40, bold: true, color: BRAND.navy },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: data.title || "", font: "Calibri", size: 24, color: BRAND.sky, bold: true }),
      ],
      spacing: { after: 100 },
    })
  );

  // Contact info line
  const contactParts = [data.email, data.phone, data.location].filter(Boolean);
  if (contactParts.length > 0) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: contactParts.join("  |  "), font: "Calibri", size: 18, color: BRAND.medGray }),
        ],
        spacing: { after: 60 },
      })
    );
  }
  if (data.linkedin_url) {
    sections.push(
      new Paragraph({
        children: [
          new TextRun({ text: data.linkedin_url, font: "Calibri", size: 16, color: BRAND.sky }),
        ],
        spacing: { after: 200 },
      })
    );
  }

  // ── Professional Summary ──
  sections.push(sectionHeading("PROFESSIONAL SUMMARY"));
  sections.push(
    new Paragraph({
      children: [
        new TextRun({ text: data.professional_summary || "N/A", font: "Calibri", size: 21, color: BRAND.darkGray }),
      ],
      spacing: { after: 200 },
    })
  );

  // ── Core Skills ──
  if (data.core_skills?.length > 0) {
    sections.push(sectionHeading("CORE COMPETENCIES"));
    // Group skills into rows of 3
    const skillRows = [];
    for (let i = 0; i < data.core_skills.length; i += 3) {
      skillRows.push(data.core_skills.slice(i, i + 3));
    }
    sections.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: skillRows.map(row =>
          new TableRow({
            children: [0, 1, 2].map(idx =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: row[idx] ? `● ${row[idx]}` : "",
                        font: "Calibri", size: 19, color: BRAND.darkGray,
                      }),
                    ],
                    spacing: { before: 40, after: 40 },
                  }),
                ],
                width: { size: 33, type: WidthType.PERCENTAGE },
                borders: noBorders(),
                shading: { type: ShadingType.SOLID, color: BRAND.lightGray },
              })
            ),
          })
        ),
      })
    );
    sections.push(new Paragraph({ spacing: { after: 200 } }));
  }

  // ── Experience ──
  if (data.experience?.length > 0) {
    sections.push(sectionHeading("PROFESSIONAL EXPERIENCE"));
    for (const exp of data.experience) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: exp.role || "", font: "Calibri", size: 22, bold: true, color: BRAND.navy }),
          ],
          spacing: { before: 120, after: 40 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: exp.company || "", font: "Calibri", size: 19, color: BRAND.sky, bold: true }),
            new TextRun({ text: `  |  ${exp.period || ""}`, font: "Calibri", size: 18, color: BRAND.medGray }),
            exp.location ? new TextRun({ text: `  |  ${exp.location}`, font: "Calibri", size: 18, color: BRAND.medGray }) : new TextRun({ text: "" }),
          ],
          spacing: { after: 60 },
        })
      );
      if (exp.highlights?.length > 0) {
        for (const h of exp.highlights) {
          sections.push(
            new Paragraph({
              children: [
                new TextRun({ text: `▸ ${h}`, font: "Calibri", size: 19, color: BRAND.darkGray }),
              ],
              spacing: { before: 20, after: 20 },
              indent: { left: 360 },
            })
          );
        }
      }
    }
    sections.push(new Paragraph({ spacing: { after: 200 } }));
  }

  // ── Education ──
  if (data.education?.length > 0) {
    sections.push(sectionHeading("EDUCATION"));
    for (const edu of data.education) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: edu.degree || "", font: "Calibri", size: 20, bold: true, color: BRAND.navy }),
            edu.field ? new TextRun({ text: ` — ${edu.field}`, font: "Calibri", size: 20, color: BRAND.darkGray }) : new TextRun({ text: "" }),
          ],
          spacing: { before: 60, after: 20 },
        }),
        new Paragraph({
          children: [
            new TextRun({ text: edu.institution || "", font: "Calibri", size: 18, color: BRAND.sky }),
            edu.year ? new TextRun({ text: `  |  ${edu.year}`, font: "Calibri", size: 18, color: BRAND.medGray }) : new TextRun({ text: "" }),
          ],
          spacing: { after: 60 },
        })
      );
    }
    sections.push(new Paragraph({ spacing: { after: 200 } }));
  }

  // ── Certifications ──
  if (data.certifications?.length > 0) {
    sections.push(sectionHeading("CERTIFICATIONS"));
    for (const cert of data.certifications) {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: `● ${cert.name}`, font: "Calibri", size: 19, bold: true, color: BRAND.darkGray }),
            cert.issuer ? new TextRun({ text: ` — ${cert.issuer}`, font: "Calibri", size: 18, color: BRAND.medGray }) : new TextRun({ text: "" }),
            cert.year ? new TextRun({ text: ` (${cert.year})`, font: "Calibri", size: 18, color: BRAND.medGray }) : new TextRun({ text: "" }),
          ],
          spacing: { before: 30, after: 30 },
        })
      );
    }
    sections.push(new Paragraph({ spacing: { after: 200 } }));
  }

  // ── Languages ──
  if (data.languages?.length > 0) {
    sections.push(sectionHeading("LANGUAGES"));
    sections.push(
      new Paragraph({
        children: data.languages.map((lang, i) => {
          const parts = [];
          if (i > 0) parts.push(new TextRun({ text: "  |  ", font: "Calibri", size: 18, color: BRAND.medGray }));
          parts.push(new TextRun({ text: lang.language, font: "Calibri", size: 19, bold: true, color: BRAND.darkGray }));
          parts.push(new TextRun({ text: ` (${lang.proficiency || "N/A"})`, font: "Calibri", size: 18, color: BRAND.medGray }));
          return parts;
        }).flat(),
        spacing: { after: 200 },
      })
    );
  }

  // ── Footer ──
  sections.push(
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 1, color: BRAND.sky } },
      spacing: { before: 300 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "PRIVATE & CONFIDENTIAL — PDPL Art. 5",
          font: "Calibri", size: 14, color: BRAND.medGray, italics: true,
        }),
      ],
      spacing: { before: 80, after: 20 },
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Prepared by Datalake Information Technology  ·  ${new Date().toISOString().split("T")[0]}  ·  DTLK-FORM-HR-CV-002-v2`,
          font: "Calibri", size: 14, color: BRAND.medGray,
        }),
      ],
      alignment: AlignmentType.CENTER,
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "CR: 109194773 | UEN: 7048904952 | www.datalake.sa",
          font: "Calibri", size: 13, color: BRAND.medGray,
        }),
      ],
      alignment: AlignmentType.CENTER,
    })
  );

  const doc = new Document({
    sections: [{ children: sections }],
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 20 } },
        heading1: { run: { font: "Calibri", size: 40, bold: true, color: BRAND.navy } },
      },
    },
  });

  return await Packer.toBuffer(doc);
}

// ── Helpers ──
function sectionHeading(text) {
  return new Paragraph({
    children: [
      new TextRun({ text, font: "Calibri", size: 22, bold: true, color: BRAND.navy, allCaps: true }),
    ],
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: BRAND.sky } },
  });
}

function noBorders() {
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return { top: none, bottom: none, left: none, right: none };
}

// ── Start server ──
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`datalake-cv-agent running on :${PORT} — Vertex AI ${MODEL}@${LOCATION}`);
});
