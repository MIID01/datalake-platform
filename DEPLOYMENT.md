# Datalake Platform — Deployment Record

**Deployed:** April 22, 2026
**Deployed by:** m.alqumri@datalake.sa
**Environment:** Firebase Hosting + Cloud Functions + Firestore
**GCP Project:** datalake-production-sa
**Region:** me-central2 (Dammam, KSA sovereign)
**Live URLs:**
- https://datalake-production-sa.web.app
- https://datalake-production-sa.firebaseapp.com

## Portal Routes
- `/` — Landing page
- `/ceo` — CEO Command Center (Google SSO protected)
- `/portal` — Engineer Portal
- `/client` — Client Timesheet Approval
- `/hr` — HR Interview Scoring
- `/careers` — Public Careers (PDPL compliant, wired to live backend)

## Backend Services
| Service | Details |
|---------|---------|
| **Cloud Function** | `submitCareerApplication` — https://submitcareerapplication-ifzodp5svq-wx.a.run.app |
| **Firestore** | Collections: `talent_pool`, `audit_log` |
| **Cloud Storage** | Bucket: `gs://datalake-cv-uploads` (400-day lifecycle) |
| **Firebase Auth** | Google SSO — CEO access gated to m.alqumri@datalake.sa |

## Security Rules
- **Firestore:** CEO-only read on `talent_pool` and `audit_log`; writes only via admin SDK (Cloud Function)
- **Auth:** Google SSO gate on CEO Command Center layout

## How to Redeploy
From the project root, run:
```bash
npm run build
firebase deploy --only hosting
```

To redeploy functions:
```bash
firebase deploy --only functions
```

## Notes
- Careers form → Cloud Function → Firestore + Cloud Storage is the first live end-to-end flow
- CEO Talent Pool reads from Firestore via real-time listener (new candidates appear instantly)
- Other modules still use mock data
- No custom domain configured yet
