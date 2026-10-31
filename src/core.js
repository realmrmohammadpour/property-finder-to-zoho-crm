export const LEAD_EVENTS = new Set([
  "lead.created",
  "lead.updated",
  "lead.assigned",
]);

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function contactItems(sender) {
  if (Array.isArray(sender?.contacts)) return sender.contacts;
  if (Array.isArray(sender?.contacts?.items)) return sender.contacts.items;
  return [];
}

export function normalizeEvent(event) {
  if (!event || typeof event !== "object" || !LEAD_EVENTS.has(event.type)) {
    throw new Error("UNSUPPORTED_EVENT");
  }
  const eventId = firstNonEmpty(event.id);
  const leadId = firstNonEmpty(event.entity?.id);
  if (!eventId || !leadId || event.entity?.type !== "lead") {
    throw new Error("INVALID_EVENT");
  }
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const sender = payload.sender && typeof payload.sender === "object" ? payload.sender : {};
  const contacts = contactItems(sender);
  const contact = (...types) => {
    const entry = contacts.find((item) =>
      types.includes(String(item?.type || "").toLowerCase()));
    return firstNonEmpty(entry?.value);
  };
  const fullName = firstNonEmpty(sender.name, sender.fullName, sender.full_name);
  const nameParts = fullName.split(/\s+/).filter(Boolean);
  const firstName = firstNonEmpty(sender.firstName, nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : "");
  const lastName = firstNonEmpty(sender.lastName, nameParts.at(-1), "Unknown");

  return {
    eventId,
    leadId,
    eventType: event.type,
    firstName,
    lastName,
    email: firstNonEmpty(sender.email, contact("email")),
    phone: firstNonEmpty(sender.phone, contact("phone", "mobile", "whatsapp")),
    channel: firstNonEmpty(payload.channel),
    listingReference: firstNonEmpty(payload.listing?.reference),
  };
}

export function retryDelaySeconds(attempt) {
  const safe = Math.max(0, Math.min(10, Number(attempt) || 0));
  return Math.min(3600, 15 * 2 ** safe);
}

export function makeZohoRecord(lead, env) {
  const field = env.ZOHO_EXTERNAL_ID_FIELD;
  if (!/^[A-Za-z][A-Za-z0-9_]{0,100}$/.test(field || "")) {
    throw new Error("MISSING_UNIQUE_FIELD");
  }
  const description = [
    "Property Finder inquiry",
    "Event: " + lead.eventType,
    "Channel: " + (lead.channel || "unspecified"),
    lead.listingReference ? "Listing reference: " + lead.listingReference : "",
  ].filter(Boolean).join("\n");

  const record = {
    Last_Name: lead.lastName,
    Company: env.ZOHO_COMPANY_LABEL || "Inbound Inquiry",
    Description: description,
  };
  record[field] = lead.leadId;
  if (lead.firstName) record.First_Name = lead.firstName;
  if (lead.email) record.Email = lead.email;
  if (lead.phone) record.Phone = lead.phone;
  return record;
}

export async function verifySignature(raw, hexSignature, secret) {
  if (!secret || !/^[0-9a-f]{64}$/i.test(hexSignature || "")) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(raw)));
  let difference = 0;
  for (let index = 0; index < expected.length; index++) {
    difference |= expected[index] ^ Number.parseInt(hexSignature.slice(index * 2, index * 2 + 2), 16);
  }
  return difference === 0;
}
