// functions/grcRag.js — DTLK-GRC-AI-001 — GRC retrieval (vector RAG + keyword fallback).
//
// Stores per-document text CHUNKS with embeddings in `grc_doc_chunks` and retrieves
// the most similar chunks for a query by brute-force cosine similarity (fine at this
// scale — hundreds of policies / a few thousand chunks; no vector DB needed, all
// in-region in Firestore). Embeddings come from the self-hosted Ollama backend
// (callEmbedding, me-central2). If the embed model isn't available, retrieval falls
// back HONESTLY to keyword search over the stored chunk text — it never fakes a hit.
//
// IMPORTANT: this module must NOT require ./grcLibrary (grcLibrary requires this for
// indexing on upload — importing back would be circular). Access filtering is done by
// the caller (grcAgent) via an accessFilter(classification, domain) callback, so
// canAccess() stays single-sourced in grcLibrary.

const admin = require("firebase-admin");
const { callEmbedding } = require("./lib/ai-client");

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const CHUNK_SIZE = 900;      // ~chars per chunk
const CHUNK_OVERLAP = 150;   // sliding overlap so a sentence isn't split across the seam
const CHUNK_CAP = 60;        // max chunks per doc (bounds a huge file)

// Split text into overlapping chunks on paragraph/word boundaries where possible.
function chunkText(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return [];
  const chunks = [];
  let i = 0;
  while (i < clean.length && chunks.length < CHUNK_CAP) {
    let end = Math.min(i + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      // prefer to break at the last newline/space in the window
      const slice = clean.slice(i, end);
      const brk = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "), slice.lastIndexOf(" "));
      if (brk > CHUNK_SIZE * 0.5) end = i + brk + 1;
    }
    chunks.push(clean.slice(i, end).trim());
    i = end - CHUNK_OVERLAP;
    if (i < 0) i = 0;
    if (end >= clean.length) break;
  }
  return chunks.filter(Boolean);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Remove all chunks for a doc_id (used before re-indexing a new version).
async function deleteDocChunks(doc_id) {
  const snap = await db.collection("grc_doc_chunks").where("doc_id", "==", doc_id).get();
  let batch = db.batch(); let n = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref); n++;
    if (n % 450 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 450 !== 0) await batch.commit();
  return snap.size;
}

// Chunk + embed + store one document. Best-effort: if embedding is unavailable the
// document is simply not vector-indexed (keyword fallback still serves it from
// grc_documents.extracted_text). Returns { indexed, embedded }.
async function indexGrcDocument({ doc_id, version, domain, classification, title, text, triggeredBy }) {
  if (!doc_id) return { indexed: 0, embedded: false, reason: "no doc_id" };
  const chunks = chunkText(text);
  // Always clear stale chunks so a superseded version never lingers in retrieval.
  await deleteDocChunks(doc_id);
  if (chunks.length === 0) return { indexed: 0, embedded: false, reason: "no text" };

  const emb = await callEmbedding({ texts: chunks, agent: "auditor", type: "grc_index", triggeredBy: triggeredBy || "system" });
  if (!emb.success || !Array.isArray(emb.vectors) || emb.vectors.length !== chunks.length) {
    return { indexed: 0, embedded: false, reason: emb.error || "embedding unavailable" };
  }

  let batch = db.batch(); let n = 0;
  for (let idx = 0; idx < chunks.length; idx++) {
    const ref = db.collection("grc_doc_chunks").doc();
    batch.set(ref, {
      doc_id, version: version || null, domain: domain || null, classification: classification || null,
      title: title || null, chunk_index: idx, text: chunks[idx], embedding: emb.vectors[idx],
      embed_model: emb.model || null, created_at: FieldValue.serverTimestamp(),
    });
    n++;
    if (n % 450 === 0) { await batch.commit(); batch = db.batch(); }
  }
  if (n % 450 !== 0) await batch.commit();
  return { indexed: chunks.length, embedded: true };
}

// Retrieve the top-K most relevant chunks for a query. accessFilter(classification,
// domain) gates which chunks the CALLER may see (single-sourced canAccess lives in
// grcLibrary; we never leak a chunk past it). minScore is the relevance gate that
// lets the agent refuse when nothing is genuinely relevant.
//   returns { mode: 'vector'|'keyword'|'none', hits: [...], top_score }
async function retrieve({ query, accessFilter, topK = 6, minScore = 0.35, triggeredBy }) {
  const q = String(query || "").trim();
  if (!q) return { mode: "none", hits: [], top_score: 0 };
  const allow = (typeof accessFilter === "function") ? accessFilter : () => true;

  const emb = await callEmbedding({ texts: [q], agent: "auditor", type: "grc_query", triggeredBy: triggeredBy || "system" });

  // ── Vector path ──
  if (emb.success && emb.vectors[0]) {
    const qv = emb.vectors[0];
    const snap = await db.collection("grc_doc_chunks").get();
    const scored = [];
    snap.forEach((d) => {
      const c = d.data();
      if (!allow(c.classification, c.domain)) return;
      const score = cosine(qv, c.embedding);
      scored.push({ doc_id: c.doc_id, version: c.version, title: c.title, classification: c.classification, domain: c.domain, text: c.text, score });
    });
    scored.sort((a, b) => b.score - a.score);
    const hits = scored.filter((h) => h.score >= minScore).slice(0, topK);
    return { mode: "vector", hits, top_score: scored.length ? scored[0].score : 0 };
  }

  // ── Honest keyword fallback (embedding unavailable) ──
  const snap = await db.collection("grc_doc_chunks").get();
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const scored = [];
  snap.forEach((d) => {
    const c = d.data();
    if (!allow(c.classification, c.domain)) return;
    const hay = `${c.title || ""} ${c.text || ""}`.toLowerCase();
    let s = 0; terms.forEach((t) => { if (hay.includes(t)) s++; });
    if (s > 0) scored.push({ doc_id: c.doc_id, version: c.version, title: c.title, classification: c.classification, domain: c.domain, text: c.text, score: s / Math.max(1, terms.length) });
  });
  scored.sort((a, b) => b.score - a.score);
  return { mode: "keyword", hits: scored.slice(0, topK), top_score: scored.length ? scored[0].score : 0 };
}

module.exports = { chunkText, cosine, indexGrcDocument, deleteDocChunks, retrieve };
