import { normalizeEvent, retryDelaySeconds, makeZohoRecord, verifySignature } from "./core.js";
import { upsertLead } from "./zoho.js";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_ATTEMPTS = 10;
const CLAIM_LEASE_SECONDS = 300;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function acceptWebhook(request, env, ctx) {
  if (!env.DB || !env.PF_WEBHOOK_SECRET) return json({ error: "not_configured" }, 503);
  if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: "too_large" }, 413);
  }
  const verified = await verifySignature(raw, request.headers.get("x-signature"), env.PF_WEBHOOK_SECRET);
  if (!verified) return json({ error: "invalid_signature" }, 401);

  let lead;
  try {
    lead = normalizeEvent(JSON.parse(raw));
  } catch {
    return json({ error: "invalid_event" }, 400);
  }

  try {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO webhook_inbox (event_id, lead_id, event_type, payload_json, status, available_at) VALUES (?, ?, ?, ?, 'pending', ?)"
    ).bind(lead.eventId, lead.leadId, lead.eventType, raw, Math.floor(Date.now() / 1000)).run();
  } catch {
    // Let the sender retry rather than acknowledging an event that was not persisted.
    return json({ error: "storage_unavailable" }, 503);
  }
  ctx.waitUntil(processQueue(env, 5).catch(() => console.error("background_queue_failed")));
  return json({ accepted: true }, 202);
}

async function processQueue(env, limit = 20) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "UPDATE webhook_inbox SET status = 'retry', claimed_at = NULL WHERE status = 'processing' AND claimed_at < ?"
  ).bind(now - CLAIM_LEASE_SECONDS).run();
  const batch = await env.DB.prepare(
    "SELECT event_id, payload_json, attempts FROM webhook_inbox WHERE status IN ('pending', 'retry') AND available_at <= ? ORDER BY created_at LIMIT ?"
  ).bind(now, limit).all();

  for (const row of batch.results || []) {
    const result = await env.DB.prepare(
      "UPDATE webhook_inbox SET status = 'processing', claimed_at = ? WHERE event_id = ? AND status IN ('pending', 'retry') AND available_at <= ?"
    ).bind(now, row.event_id, now).run();
    if (Number(result.meta?.changes || 0) !== 1) continue;

    try {
      const lead = normalizeEvent(JSON.parse(row.payload_json));
      await upsertLead(env, makeZohoRecord(lead, env));
      await env.DB.prepare(
        "UPDATE webhook_inbox SET status = 'done', claimed_at = NULL, error_code = NULL WHERE event_id = ?"
      ).bind(row.event_id).run();
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const state = attempts >= MAX_ATTEMPTS ? "dead" : "retry";
      const safeCode = String(error?.message || "SYNC_FAILED").replace(/[^A-Z0-9_]/gi, "_").slice(0, 80);
      await env.DB.prepare(
        "UPDATE webhook_inbox SET status = ?, attempts = ?, available_at = ?, claimed_at = NULL, error_code = ? WHERE event_id = ?"
      ).bind(state, attempts, now + retryDelaySeconds(attempts), safeCode, row.event_id).run();
      console.error("lead_sync_failed", safeCode);
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, mode: "public-reference" });
    }
    if (url.pathname === "/webhooks/property-finder" && request.method === "POST") {
      return acceptWebhook(request, env, ctx);
    }
    return json({ error: "not_found" }, 404);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processQueue(env, 25).catch(() => console.error("scheduled_queue_failed")));
  },
};
