-- Generic D1 inbox. Payloads can include personal information; apply a retention policy.
CREATE TABLE IF NOT EXISTS webhook_inbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  lead_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'done', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER NOT NULL DEFAULT (unixepoch()),
  claimed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_due
ON webhook_inbox(status, available_at);

CREATE INDEX IF NOT EXISTS idx_webhook_inbox_lead
ON webhook_inbox(lead_id);
