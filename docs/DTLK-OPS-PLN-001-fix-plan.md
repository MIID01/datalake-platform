# Datalake Platform — Verified State & Fix Plan

**Document ID:** DTLK-OPS-PLN-001
**Version:** 1.0
**Date:** April 27, 2026 (evening)
**Owner:** CEO (Mido)
**Source:** Verification of Antigravity DevOps Report + live gcloud + UI test

---

## Verified Platform State

### ✅ Confirmed Real

| Component | Detail |
|---|---|
| Cloud Functions deployed | 20 services in me-central2, listed below |
| Frontend | Real codebase, ~60 files, in Git on GitHub (commit 9e30501) |
| Source code | Internally consistent — functions reference correct collections |
| 13 Firestore collections referenced in code | Defined in firestore.rules |

### ❌ Real Problems

| Problem | Detail |
|---|---|
| Vertex AI Gemini | Code references `gemini-2.5-flash` in me-central2; UI shows manual fallback (model still not responding) |
| Demo client token | `DEMO_EMKAN_001` hardcoded in `functions/index.js` line 1063 |
| CORS wide open | 19 instances of `cors: true`, no origin restriction |
| 10 of 14 CEO pages | Use mock data (Pipeline, Finance, Contracts, Approvals, Compliance, Analytics, AI Operations, Alerts, System Health) |

### ❓ Unverified

| Item | Why open |
|---|---|
| Firestore live data | Visual check of console skipped; users/roles/access_matrix/clients existence not confirmed |
| Vertex AI live response | Curl auth issue (Windows token expansion), browser test confirmed model not responding |

---

## The 20 Deployed Cloud Functions

1. adduser
2. assignengineertoproject
3. clientsigntimesheet
4. createcustomrole
5. createproject
6. createtask
7. ctoapprovetimesheet
8. deletecustomrole
9. disableuser
10. escalatestaletimesheets (scheduled)
11. extractcvdata
12. getclienttimesheets
13. getengineerprojectview
14. getmytimesheets
15. getrbacstate
16. submitcareerapplication
17. submithrscore
18. submittimesheet
19. updateaccessmatrix
20. updateuserrole

---

## Fix Plan — Three Buckets

### TONIGHT/TOMORROW MORNING (3-5 hours)

| # | Fix | Effort | Why |
|---|---|---|---|
| 1 | Diagnose Vertex AI failure | 30 min | Decides whether to fix AI or rewrite careers flow |
| 2 | CORS lockdown to known origins | 1-2 hrs | Closes abuse vector |
| 3 | Replace demo client token with Firebase Auth | 2-3 hrs | Closes PDPL exposure |

### THIS WEEK (15-25 hours)

| # | Fix | Effort |
|---|---|---|
| 4 | CI/CD pipeline (GitHub Actions) | 4-6 hrs |
| 5 | Firestore audit + reseed if needed | 1-2 hrs |
| 6 | Fix AI extraction OR rewrite careers as unified flow | 8-12 hrs |
| 7 | Privacy policy architecture (single consent + versioning + re-consent) | 6-10 hrs |

### THIS MONTH (40-80 hours)

| # | Fix | Effort |
|---|---|---|
| 8 | Wire 10 mock CEO pages to live data | 15-25 hrs |
| 9 | Error monitoring + staging environment | 4-8 hrs |
| 10 | Custom domain (app.datalake.sa) | 2-4 hrs |
| 11 | Mobile responsive sweep | 8-12 hrs |
| 12 | CSS contrast sweep | 3-4 hrs |
| 13 | Schema mapping audit | 4-6 hrs |
| 14 | Tests (smoke + revenue loop) | 20-40 hrs |

---

## Total Effort

| Bucket | Hours | Outcome |
|---|---|---|
| Tonight/tomorrow morning | 3-5 hrs | Security hardened, AI diagnosed |
| This week | 15-25 hrs | CI/CD, careers fixed, privacy done |
| This month | 40-80 hrs | Production-grade platform |
| **Total** | **58-110 hrs** | Regulator-ready, demo-ready |

---

## Structural Integrity Audit

**Regulatory Anchor:** PDPL Art. 18 (CORS lockdown reduces unauthorized access surface), SAMA TPRM (CI/CD provides change management evidence), NCA ECC 1-7 (Documented Information — this plan satisfies it), PDPL Art. 15 (privacy policy versioning + re-consent on material changes).

---

**Version:** 1.0
**Effective:** April 27, 2026
**Owner:** CEO, Datalake Saudi Arabia
**Classification:** Internal — Operations Plan
