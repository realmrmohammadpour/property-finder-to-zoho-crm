// Shared across requests served by one isolate. Secrets remain in Worker environment.
let accessTokenCache = null;

async function getAccessToken(env) {
  const required = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
  if (required.some((name) => !env[name])) throw new Error("ZOHO_CONFIG_MISSING");

  const accountsUrl = (env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.com").replace(/\/$/, "");
  const cacheKey = env.ZOHO_CLIENT_ID + "|" + accountsUrl;
  if (accessTokenCache?.key === cacheKey && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN,
  });

  const response = await fetch(accountsUrl + "/oauth/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("ZOHO_AUTH_HTTP_" + response.status);
  const payload = await response.json();
  if (!payload.access_token) throw new Error("ZOHO_AUTH_INVALID_RESPONSE");

  accessTokenCache = {
    key: cacheKey,
    token: payload.access_token,
    apiDomain: (env.ZOHO_API_DOMAIN || payload.api_domain || "https://www.zohoapis.com").replace(/\/$/, ""),
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000 - 120000,
  };
  return accessTokenCache;
}

export async function upsertLead(env, record) {
  const auth = await getAccessToken(env);
  const response = await fetch(auth.apiDomain + "/crm/v8/Leads/upsert", {
    method: "POST",
    headers: {
      Authorization: "Zoho-oauthtoken " + auth.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: [record],
      duplicate_check_fields: [env.ZOHO_EXTERNAL_ID_FIELD],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("ZOHO_UPSERT_HTTP_" + response.status);
  const result = await response.json();
  const first = result?.data?.[0];
  if (first?.status !== "success") throw new Error("ZOHO_UPSERT_REJECTED");
  return first.details?.id;
}
