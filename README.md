# Property Finder to Zoho CRM

A **public reference implementation** of a server-to-server lead integration using **Cloudflare Workers**, **D1**, signed **Property Finder webhooks**, and **Zoho CRM**.

This is a generalized, independently maintainable example. It is **not** a copy of a live customer deployment and does not contain business-specific routing rules, customer data, live endpoints, credentials, or production database identifiers.

## Architecture

```text
Property Finder (lead.created / lead.updated / lead.assigned)
     |
     | HTTPS POST + X-Signature (HMAC-SHA256)
     v
Cloudflare Worker -> D1 inbox (event ID is unique)
                         |
                         | background processing + scheduled retries
                         v
                  Zoho CRM Leads Upsert
                  (unique external lead ID)
```

## Features

- Verifies the HMAC-SHA256 signature over the **raw, unmodified request body**; refuses unsigned events.
- Persists before acknowledging delivery; responds quickly with HTTP 202.
- Handles at-least-once delivery with an event-ID primary key.
- Uses a D1-backed queue with claim guards, bounded retries, lease recovery, and a dead-letter state.
- Upserts to Zoho CRM using a **custom unique external-ID field**, instead of deduplicating by email.
- Uses an OAuth refresh token from Worker secrets and a short-lived in-memory token cache.
- Provides read-only `GET /health` without publishing lead data or administrative operations.

## What this repository does *not* do

This example intentionally omits tenant-specific Zoho layouts, agent-to-owner mapping, listing registries, historic lead reconciliation, multi-account behavior, operational admin endpoints, and automatic deployment. Do **not** replace an existing production Worker with this example without a separate migration and integration review.

## Requirements

- Cloudflare Workers and a bound D1 database (`DB`).
- A Property Finder Enterprise API subscription for each needed lead event with a configured signing secret. Subscription creation requires `webhooks:full_access` and lead events require `leads:read`.
- Zoho CRM OAuth credentials with Leads write permission.
- A **single-line custom field** in Zoho Leads, e.g. `External_Lead_ID`, configured as **unique** ("Do not allow duplicate values"). Set its actual API name in `ZOHO_EXTERNAL_ID_FIELD`.
- Node.js 20+ for local unit tests.

## Setup (example, not a production deployment procedure)

1. Create your own D1 database and apply `migrations/0001.sql`.
2. Copy `wrangler.toml.example` to a local `wrangler.toml`. Set your **own** D1 ID and callback route. Do not commit `wrangler.toml` if it contains real infrastructure details.
3. Set Worker secrets (not plain variables): `PF_WEBHOOK_SECRET`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`.
4. Set `ZOHO_EXTERNAL_ID_FIELD` to your unique Zoho Leads field API name. Optionally configure `ZOHO_ACCOUNTS_URL`, `ZOHO_API_DOMAIN`, and `ZOHO_COMPANY_LABEL`.
5. Register webhook subscriptions using the official Enterprise API, with exactly the same `PF_WEBHOOK_SECRET`. Point them to `/webhooks/property-finder`.
6. Test in a sandbox, verify D1 status transitions, and validate Zoho field permissions before accepting real data.

Run `npm test` for the offline unit suite. No live credentials are needed.

## Reliability and privacy notes

- Webhook acknowledgments occur only **after** successful D1 persistence; queue processing also runs on a five-minute scheduled trigger, so a failed background task is retried.
- Zoho's unique external-ID field is required to make CRM writes idempotent after a partial failure. Incorrect unique-field configuration is a deployment blocker.
- Lead payloads contain personal data. Protect D1 access, configure appropriate retention and operational monitoring, and never log or commit payloads.
- Subscription Secret, API Secret, and OAuth tokens are separate credentials.
- This repository deliberately contains no automated deployment pipeline.

## Official documentation

- [Property Finder API documentation](https://app.propertyfinder.ae/api-docs) (login required)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
- [Zoho CRM Upsert v8](https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html)

No open-source license is granted by public repository visibility. Contact the author before reuse beyond GitHub's standard visibility and forking permissions.
