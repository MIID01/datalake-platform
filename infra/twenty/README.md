# Twenty CRM — self-hosted, in-KSA (me-central2)

Runbook to stand up **Twenty** (open-source, Salesforce-like CRM) self-hosted in
`me-central2` for PDPL residency, then wire the platform's **own** self-hosted LLM
to it. **We do NOT use Twenty's built-in AI agents** (they'd call external models —
residency violation); our Cloud Functions call Gemma/Qwen and write results into
Twenty via its API.

> Source of truth for this runbook: the official docs at
> https://docs.twenty.com/developers/self-host/capabilities/docker-compose and
> https://docs.twenty.com/developers/extend/api . Use Twenty's **official**
> docker-compose / install script — do not hand-roll the service definitions.

## ⚠ License — decide before production / white-label
Twenty is **AGPL-3.0** (network-copyleft: if you modify it and expose it over the
network, modified source must be made available) **plus** a commercial license on
`@license Enterprise` files (**reselling/sublicensing prohibited** without a Twenty
Enterprise subscription). For internal use this is fine. **For white-labeling /
reselling to other companies, get legal sign-off first.** (Ties to [[white-label-config]].)

## What this is (architecture)
```
  [Twenty CRM]  ── self-hosted VM, me-central2, Postgres+Redis ──┐
       ▲  REST/GraphQL (Bearer API key)                          │ webhooks
       │                                                          ▼
  [datalake Cloud Functions]  ── sync ⇄ Firestore (clients/projects/invoicing)
       │
       └── calls our self-hosted LLM (Gemma/Qwen on the in-KSA GPU) → writes back to Twenty
```
- **Single source of truth stays Firestore** for the billing chain (clients →
  projects → POs → timesheets → invoicing → payroll). Twenty is the sales/CRM
  surface; a sync keeps deals↔clients aligned (no parallel drift).

## Prerequisites (BLOCKERS — needed before this can run)
1. **gcloud re-auth** — `gcloud auth login` (the token expired; provisioning a VM
   can't run non-interactively).
2. **Hosting decision:**
   - **Option A (recommended, matches docs):** one Compute Engine VM in me-central2
     (e2-medium, ≥2 GB RAM, Ubuntu + Docker) running Twenty's docker-compose (app +
     worker + Postgres + Redis on the box).
   - **Option B (more managed):** Cloud Run (app/worker) + Cloud SQL Postgres +
     Memorystore Redis — more pieces, more cost, more ops.
3. **A domain** for `SERVER_URL` (e.g. `crm.datalake.sa`) + SSL (Caddy/nginx reverse
   proxy or a managed cert).

## Deploy steps (Option A — run once gcloud is re-authed)
```bash
# 1. VM in me-central2 (Dammam) — keeps data in-KSA
gcloud compute instances create twenty-crm \
  --project=datalake-production-sa --zone=me-central2-a \
  --machine-type=e2-medium --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --tags=https-server,http-server

# 2. Firewall for 80/443 (if not already open)
gcloud compute firewall-rules create allow-web \
  --project=datalake-production-sa --allow=tcp:80,tcp:443 --target-tags=http-server,https-server

# 3. SSH in, install Docker + Docker Compose, then run Twenty's OFFICIAL installer
#    (see docs.twenty.com self-host). Set these env vars:
#      ENCRYPTION_KEY=$(openssl rand -base64 32)
#      PG_DATABASE_PASSWORD=<strong random>
#      SERVER_URL=https://crm.datalake.sa
# 4. Put a reverse proxy (Caddy gets you auto-HTTPS) in front of port 3000.
# 5. Point DNS crm.datalake.sa → the VM's external IP.
```

## After Twenty is up
1. In Twenty: **Settings → API & Webhooks → Create key** → store as a secret.
2. Set platform config (Secret Manager / functions env):
   `TWENTY_API_URL=https://crm.datalake.sa`  ·  `TWENTY_API_KEY=<key>`
3. Then the integration layer gets built in `functions/` (see Task #6):
   - a Twenty API client (Bearer key) for Companies/People/Opportunities,
   - Firestore⇄Twenty sync (deal won → client/project),
   - an LLM-wiring function (our Gemma/Qwen → write enrichment/notes into Twenty),
   - subscribe to Twenty webhooks for record changes.

## Status
- Docs read + architecture + license confirmed (2026-06-19).
- **NOT yet provisioned** — blocked on gcloud re-auth + the hosting/domain decision above.
- Integration code is built only after Twenty has a live URL + API key.
