# DNS & Email Authentication — datalake.sa

Last verified: 2026-05-24 (via public resolvers 8.8.8.8 and 1.1.1.1).

## TL;DR

Outbound mail lands in junk because the domain has **no SPF, no DMARC, and no Gmail DKIM**.
The mailboxes are on **Microsoft 365**, but the app's Cloud Functions send via the **Gmail
API with domain-wide delegation** (`functions/gmail.js`) — so the domain effectively sends
from two systems and currently authorizes neither.

## Current records

| Type  | Host                    | Value                                                              | Meaning |
|-------|-------------------------|-------------------------------------------------------------------|---------|
| MX    | `datalake.sa`           | `datalake-sa.mail.protection.outlook.com` (pref 32767)            | Microsoft 365 / Exchange Online hosts inbound mail |
| TXT   | `datalake.sa`           | **(none)**                                                        | ❌ No SPF |
| CNAME | `selector1._domainkey`  | `selector1-datalake-sa._domainkey.datalakesa.onmicrosoft.com`     | Microsoft DKIM selector present |
| CNAME | `selector2._domainkey`  | `selector2-datalake-sa._domainkey.datalakesa.onmicrosoft.com`     | Microsoft DKIM selector present |
| TXT   | `google._domainkey`     | **(none)**                                                        | ❌ No Google/Gmail DKIM |
| TXT   | `_dmarc`                | **(none)**                                                        | ❌ No DMARC |

> **Architecture mismatch to resolve:** Gmail API domain-wide delegation only works if
> `datalake.sa` is also a Google Workspace domain. Confirm whether automated mail should be
> sent via Google Workspace (Gmail API) or migrated to Microsoft 365 (Graph API), then keep
> only the matching `include:` in SPF below.

## Records to add

These are edited at the **DNS host for the `datalake.sa` nameservers** (not in this repo and
not in Firebase). Claude Code cannot edit DNS.

### 1. SPF — TXT at apex (`@`)

Authorize only the senders you actually use. Keep this as a **single** TXT record (multiple
SPF records is itself a failure), and stay under SPF's 10-DNS-lookup limit.

```
v=spf1 include:spf.protection.outlook.com include:_spf.google.com -all
```

- `include:spf.protection.outlook.com` — Microsoft 365 sending.
- `include:_spf.google.com` — Google Workspace / Gmail API sending.
- Drop whichever `include:` does not apply once the architecture decision above is made.

### 2. Gmail / Google Workspace DKIM — TXT at `google._domainkey`

Generate in Google Admin → Apps → Google Workspace → Gmail → **Authenticate email**, publish
the `v=DKIM1; k=rsa; p=…` value it produces at host `google._domainkey`, then click **Start
authentication**.

### 3. Microsoft 365 DKIM — already present as CNAMEs, must be ENABLED

The `selector1` / `selector2` CNAMEs exist, but signing must be turned on in the Microsoft 365
Defender portal → Email & collaboration → Email authentication → **DKIM** → enable for
`datalake.sa`. Presence of the CNAMEs ≠ enabled.

### 4. DMARC — TXT at `_dmarc`

Start in monitor mode, then tighten after SPF + DKIM pass for ~1–2 weeks
(`p=none` → `p=quarantine` → `p=reject`).

```
v=DMARC1; p=none; rua=mailto:dmarc@datalake.sa; fo=1
```

## Verify after changes

```powershell
Resolve-DnsName datalake.sa -Type TXT -Server 8.8.8.8 | Select-Object -Expand Strings
Resolve-DnsName google._domainkey.datalake.sa -Type TXT -Server 8.8.8.8 | Select-Object -Expand Strings
Resolve-DnsName _dmarc.datalake.sa -Type TXT -Server 8.8.8.8 | Select-Object -Expand Strings
```
