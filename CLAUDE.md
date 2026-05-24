# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Datalake Platform is a single-page React app (Vite) backed by Firebase. It serves a Saudi data-consulting business as several **role-based portals** (CEO, CTO, HR, Employee, Client) over one Firestore database, with heavy server-side workflows (recruitment, hiring, timesheets, invoicing, GRC/compliance) implemented as Google Cloud Functions. Everything is region-locked to **`me-central2`** (Saudi Arabia) for ZATCA (e-invoicing) and PDPL (data-privacy) compliance.

## Commands

Frontend (repo root):
- `npm run dev` — Vite dev server at `http://localhost:5173`
- `npm run build` — production build to `dist/` (this is what Hosting serves)
- `npm run lint` — ESLint over the repo
- `npm run preview` — serve the built `dist/`

E2E (Cypress, baseUrl `http://localhost:5173` — start `npm run dev` first):
- `npx cypress open` — interactive runner
- `npx cypress run` — headless, all specs
- `npx cypress run --spec "cypress/e2e/<file>.cy.js"` — single spec
- Test users/secrets come from `cypress.env.json` (gitignored; see `cypress.env.json.template`)

There is **no unit-test runner** — `functions/` `npm test` is a stub. "Tests" means Cypress E2E.

Deploy (project `datalake-production-sa`):
- `npm run build && firebase deploy --only hosting --project=datalake-production-sa`
- `firebase deploy --only functions --project=datalake-production-sa`
- `firebase deploy --only firestore:rules` / `--only storage`
- Deploying requires interactive `firebase login` / `gcloud auth` — ask the user to run auth commands via the `!` prefix rather than attempting it yourself.

## Architecture

### Auth & routing (the core flow)
1. `src/pages/LandingPage.jsx` — Google sign-in. On auth change it calls `resolveUserRole()` and `navigate(homePathForRole(role))`. **LandingPage owns post-login navigation.**
2. `src/components/AuthGate.jsx` wraps all routes (`src/App.jsx`). It resolves the user, renders Access-Denied / Disabled / consent-pending screens, and enforces portal boundaries: a user whose path falls outside `portalPrefixForRole(role)` is redirected to `homePathForRole(role)`.
3. `src/lib/routes.js` is the **single source of truth** for role→path mapping (`homePathForRole`, `portalPrefixForRole`). Do not hardcode portal paths elsewhere — add/extend cases here.
4. `src/lib/auth.js` holds `signIn`, `resolveUserRole(uid, email)`, and `CEO_EMAIL`.

Role resolution precedence (used identically in `resolveUserRole` and AuthGate): **UID-keyed `users` doc → `users` query by `email` → email fallbacks**. Two emails are hardcoded bypasses on both client and in `firestore.rules`: `m.alqumri@datalake.sa` (=`CEO_EMAIL`, always `ceo`) and `hr@datalake.sa` (always `hr`). Keep these in sync across `src/lib/auth.js`, `AuthGate.jsx`, and `firestore.rules` if changed.

Roles: `ceo`, `cto`, `hr`, `employee`, `client`, `finance`. `finance` lives *under* the CEO portal at `/ceo/finance`.

### Frontend data model
- **No global state library.** State is local `useState` plus live Firestore `onSnapshot` listeners. Layouts (`src/layouts/*Layout.jsx`) own the user-data subscription and the sidebar/onboarding/theme shell; pages own their own queries.
- **Hybrid backend access:** read/realtime data goes **directly through the Firestore SDK** from the client; mutations with side effects (email, document generation, external sync, AI) go through **Cloud Functions** via `fetch(URL, { headers: { Authorization: \`Bearer ${idToken}\` }})`. All function URLs are exported as constants from `src/lib/firebase.js` (Cloud Run `*-ifzodp5svq-wx.a.run.app`).
- `src/hooks/useAccessProfile.js` resolves RBAC permissions from the `users`/`roles`/`access_matrix` collections for fine-grained UI gating.

### Backend (`functions/`, Node 22, Firebase Functions v2)
~60+ functions exported from `functions/index.js`, all pinned to `me-central2`: mostly `onRequest` HTTP endpoints, plus a few `onSchedule` crons and Firestore triggers. Domains: recruitment/CV, hiring & contracts, timesheets/projects, finance/invoicing, RBAC admin, GRC/compliance, offboarding, forecasting.

Shared library in `functions/lib/`:
- `access.js` — RBAC: `getUserAccessProfile`, data-class `canRead`/`filterByAccess`, audit logging.
- `ai-client.js` — the **only** path to AI. LLM (Qwen via Ollama) and OCR (PaddleOCR) are **self-hosted on Cloud Run over VPC, no external APIs**. Every call is logged append-only to BigQuery with a SHA-256 input hash (no raw prompts stored).
- `gmail.js` — transactional email via Workspace domain-wide delegation (IAM `signJwt`, no key files).
- `zoho-connector.js` / `accounting-connector.js` — Zoho Books OAuth/sync; credentials from Secret Manager.
- `invoicing.js` — invoice lifecycle + ZATCA Phase-2 UBL XML (15% VAT).

Auth in functions: verify `Authorization: Bearer <idToken>` with `admin.auth().verifyIdToken()`, then gate by role. Public exceptions: `submitCareerApplication`, `zohoPaymentWebhook`.

External services: **BigQuery** (`datalake_audit`, `datalake_finance` — immutable/append-only audit), **Cloud Storage** (`datalake-cv-uploads`, WORM `datalake-worm-hr`, `datalake-grc-library`), **Secret Manager**, **Google Workspace Directory** (provision/offboard accounts), **Zoho Books**.

### Authorization layers (defense in depth)
`firestore.rules` is the real security boundary for direct client reads/writes (CEO-only writes on RBAC collections, role checks via `getUserRole()`, `client_id` scoping). Cloud Functions re-verify role for privileged operations. AuthGate / `routes.js` are **UX routing only** — never the trust boundary.

## Conventions
- ESM throughout (`"type": "module"`). React 19, React Router 7.
- Styling: CSS custom-property design tokens in `src/index.css`, per-portal stylesheets in `src/styles/` (`ceo.css` dark navy `#010e2b`/accent `#1598CC`; `engineer.css` light). Inline styles only for dynamic values.
- Hosting is a SPA: `firebase.json` rewrites all paths to `/index.html`. New top-level routes must be registered in `src/App.jsx`; client-side navigation must target paths that exist there (a missing route renders a blank page).
- Lifecycle data uses explicit state machines (e.g. candidate `APPLIED → … → ACTIVE_EMPLOYEE`, timesheet `SUBMITTED → CTO_APPROVED → CLIENT_SIGNED`); transitions are validated server-side — follow the existing allowed-transition maps rather than setting states ad hoc.

## Business Context & Rules

### Active Employees (12)
Mohammed Alqumri (CEO, m.alqumri@datalake.sa), Khalid Mohammed (Finance, finance@datalake.sa), Mahmoud Abdelghany (mah.abdelghany@datalake.sa), Mohamed Dahas (moh.dahas@datalake.sa), Marwen Benalayat (mar.benalayat@datalake.sa), Salaheddine Gragba (saleh.gragba@datalake.sa), Marwan Ayoub (mar.ayoub@datalake.sa), Alaa Alkattan (alaa.alkattan@datalake.sa), Bassam Soliman (Technical Director NOT CTO, bassam.soliman@datalake.sa), Mohamed Ashraf (moh.ashraf@datalake.sa), Mahmoud Metawea (mah.metawea@datalake.sa), Marwan Mohsen (mohamed.mohsen@datalake.sa)

### CTO Role
VACANT. CEO acts as CTO for timesheet approval. CTO portal stays built but unused.

### Design System
Navy #022873, Sky Blue #1598CC, Orange #EF5829, Green #34BF3A. Background #F4F6F9, Cards #FFFFFF, Border #E5E7EB. Sidebar 260px fixed left navy. Font DM Sans fallback Arial. Icons Lucide React.

### Hard Rules
- Every page: loading, error, empty states. Never blank.
- No mock data. No hardcoded values. Read from Firestore.
- No allUsers IAM. Use domain:datalake.sa + service account only.
- No min-instances on Cloud Run.
- Timesheet chain: SUBMITTED > CTO_APPROVED > CLIENT_SIGNED > INVOICED
- All data in me-central2.
- Test with npm run build not just dev.
- Do not add features not in the master tracker.
