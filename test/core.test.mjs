import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { normalizeEvent, retryDelaySeconds, makeZohoRecord, verifySignature } from "../src/core.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const fixture = {
  id: "event-demo-001",
  type: "lead.created",
  timestamp: "2026-01-01T12:00:00Z",
  entity: { id: "lead-demo-001", type: "lead" },
  payload: {
    channel: "whatsapp",
    listing: { reference: "LISTING-EXAMPLE" },
    sender: {
      name: "Sample Customer",
      contacts: [{ type: "email", value: "sample@example.invalid" }],
    },
  },
};

test("normalizes supported lead events without tenant-specific data", () => {
  const lead = normalizeEvent(fixture);
  assert.equal(lead.leadId, "lead-demo-001");
  assert.equal(lead.lastName, "Customer");
  assert.equal(lead.email, "sample@example.invalid");
  assert.equal(lead.listingReference, "LISTING-EXAMPLE");
});

test("rejects unsupported and incomplete events", () => {
  assert.throws(() => normalizeEvent({ ...fixture, type: "listing.published" }), /UNSUPPORTED_EVENT/);
  assert.throws(() => normalizeEvent({ ...fixture, entity: { type: "lead" } }), /INVALID_EVENT/);
});

test("supports the documented contacts.items shape", () => {
  const lead = normalizeEvent({
    ...fixture,
    payload: { sender: { contacts: { items: [{ type: "phone", value: "+10000000000" }] } } },
  });
  assert.equal(lead.phone, "+10000000000");
  assert.equal(lead.lastName, "Unknown");
});

test("Zoho mapping requires an explicit unique field", () => {
  const lead = normalizeEvent(fixture);
  assert.throws(() => makeZohoRecord(lead, {}), /MISSING_UNIQUE_FIELD/);
  const record = makeZohoRecord(lead, { ZOHO_EXTERNAL_ID_FIELD: "External_Lead_ID" });
  assert.equal(record.External_Lead_ID, "lead-demo-001");
  assert.equal(record.Company, "Inbound Inquiry");
});

test("HMAC verification checks the raw body and rejects unsigned payloads", async () => {
  const secret = "example-only-not-a-real-secret";
  const raw = JSON.stringify(fixture);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  const signature = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifySignature(raw, signature, secret), true);
  assert.equal(await verifySignature(raw + " ", signature, secret), false);
  assert.equal(await verifySignature(raw, null, secret), false);
});

test("retries are bounded", () => {
  assert.ok(retryDelaySeconds(2) > retryDelaySeconds(1));
  assert.equal(retryDelaySeconds(100), 3600);
});
