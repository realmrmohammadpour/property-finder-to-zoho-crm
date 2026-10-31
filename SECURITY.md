# Security

This is a public reference implementation, **not** a production configuration.

- Never commit API keys, OAuth tokens, signing secrets, D1 exports, real lead payloads, agent/owner mappings, or live account IDs.
- Store secrets in Cloudflare Worker **Secrets**, never in source control or plaintext Wrangler variables.
- Use unique, per-environment webhook signing secrets. Do not accept unsigned webhook events.
- Treat D1 rows as personal data; configure access controls, monitoring, retention, and deletion appropriate for your jurisdiction.
- Rotate exposed credentials and review Git history, not just the latest files.
- Test all changes in a separate environment before deployment.

Please avoid filing issues containing operational URLs, customer data, or credentials.
