const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-")
    .replace(/\//g, "_");
let cached: { token: string; until: number } | undefined;
async function accessToken(sa: { client_email: string; private_key: string }) {
  if (cached && cached.until > Date.now() + 60000) return cached.token;
  const now = Math.floor(Date.now() / 1000), enc = new TextEncoder();
  const unsigned =
    b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))) + "." +
    b64url(
      enc.encode(
        JSON.stringify({
          iss: sa.client_email,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        }),
      ),
    );
  const der = Uint8Array.from(
    atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    enc.encode(unsigned),
  );
  const result = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + b64url(new Uint8Array(signature)),
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!result.ok) throw new Error("FCM_AUTH_UNAVAILABLE");
  const data = await result.json();
  cached = {
    token: data.access_token,
    until: Date.now() + data.expires_in * 1000,
  };
  return cached.token;
}

export async function sendUpdatePush(
  deviceToken: string,
  title: string,
  body: string,
  eventId: string,
  version: string,
) {
  const encoded = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON_B64");
  if (!encoded) return false;
  const sa = JSON.parse(atob(encoded));
  const token = await accessToken(sa);
  const result = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: deviceToken,
          notification: { title, body },
          data: {
            event_id: eventId,
            kind: "app_update",
            version,
            route: "/me?updates=1",
          },
          android: {
            ttl: "86400s",
            collapse_key: eventId,
            notification: { tag: eventId, channel_id: "rexrun-updates" },
          },
        },
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  return result.ok;
}
