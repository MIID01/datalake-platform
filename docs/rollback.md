# Rollback Runbook

How to roll back each layer of the Datalake Platform when a deploy goes bad.
Project: **`datalake-production-sa`** · Region: **`me-central2`** · Hosting site: **`datalake-production-sa.web.app`**

> Prereqs: `firebase login` and `gcloud auth login` (interactive). Confirm the active
> project first: `firebase use datalake-production-sa` / `gcloud config set project datalake-production-sa`.

---

## 1. Firebase Hosting rollback (frontend / `dist`)

Hosting keeps every released version; rolling back is instant and does not require a rebuild.

**Fastest — Console:** Firebase Console → Hosting → **Release history** → on the previous good
release click **⋮ → Rollback**. Traffic switches immediately.

**CLI:**
```bash
# List recent releases (note the version that was good)
firebase hosting:releases:list --project datalake-production-sa

# Re-deploy a previous build from git instead (clean, reproducible):
git checkout <good-tag-or-sha>
npm ci && npm run build
firebase deploy --only hosting --project datalake-production-sa
git checkout main
```

The CI pipeline (`.github/workflows/deploy.yml`) deploys to a **preview channel** and only
promotes to live on green tests — so a failed CI run never changes live. To undo a *promoted*
release, use the Console rollback above or re-promote a known-good preview:
```bash
firebase hosting:clone datalake-production-sa:<good-channel> datalake-production-sa:live
```

---

## 2. Cloud Run revision rollback (Cloud Functions v2)

All functions are Gen-2 (Cloud Run services) in `me-central2`. Each deploy creates a new
**revision**; roll back by shifting 100% traffic to the previous healthy revision.

```bash
# Identify the function's Cloud Run service (lowercased name), e.g. getmytimesheets
gcloud run revisions list --service getmytimesheets --region me-central2

# Point all traffic back to the previous good revision
gcloud run services update-traffic getmytimesheets \
  --region me-central2 --to-revisions <REVISION_NAME>=100
```

To redeploy the previous code instead of just shifting traffic:
```bash
git checkout <good-tag-or-sha>
firebase deploy --only functions:getMyTimesheets --project datalake-production-sa
git checkout main
```

> Note: a few functions are Pub/Sub subscribers (event-triggered), not HTTP — same revision
> rollback applies. Do **not** add min-instances during rollback (platform rule).

---

## 3. Firestore rules rollback

Rules are versioned in the Console and tracked in git (`firestore.rules`).

**Console:** Firestore → **Rules** → **History** tab → select a prior ruleset → **Restore**.

**CLI (from git):**
```bash
git checkout <good-tag-or-sha> -- firestore.rules
firebase deploy --only firestore:rules --project datalake-production-sa
git checkout main -- firestore.rules   # restore working tree afterward
```

Same procedure for Storage rules (`storage.rules`):
```bash
git checkout <good-tag-or-sha> -- storage.rules
firebase deploy --only storage --project datalake-production-sa
```

> Rules are the real security boundary — after any rollback, re-verify the two hardcoded
> bypass emails (`m.alqumri@datalake.sa`, `hr@datalake.sa`) are still present.

---

## 4. Git tag rollback

Every successful CI deploy is tagged `v{date}-{time}` (UTC), e.g. `v20260526-141233`.

```bash
# See available deploy tags (newest first)
git tag --list 'v*' --sort=-creatordate | head

# Inspect what a tag contains
git show <tag> --stat

# Option A — re-deploy a known-good tag without moving main (preferred)
git checkout <good-tag>
npm ci && npm run build
firebase deploy --only hosting --project datalake-production-sa
git checkout main

# Option B — revert specific bad commits on main (keeps history, no force-push)
git revert <bad-sha>            # creates an inverse commit
git push origin main

# Option C — last resort: reset main to a good tag (rewrites history, coordinate first)
git reset --hard <good-tag>
git push origin main --force-with-lease   # NEVER plain --force; warn the team to re-clone
```

---

## Recommended rollback order

1. **Hosting** (Console rollback) — restores the UI instantly, lowest risk.
2. **Cloud Run revision** — if a function deploy is the culprit.
3. **Firestore/Storage rules** — if a rules change broke reads/writes.
4. **Git tag/commit** — to make the rollback durable in source and trigger a clean CI redeploy.

After any rollback: hard-refresh the app (the hosting cache headers serve `index.html`
`no-cache`, so a single refresh picks up the reverted version) and smoke-test login + the
affected portal.
