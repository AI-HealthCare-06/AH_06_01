import { createClient } from "npm:@supabase/supabase-js@2.118.0";
const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers });
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
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return json(401, { error: "AUTH_REQUIRED" });
  }
  const url = Deno.env.get("SUPABASE_URL")!,
    publicKey = Deno.env.get("SUPABASE_ANON_KEY")!,
    secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(url, publicKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser(
    authorization.slice(7),
  );
  if (error || !user) return json(401, { error: "SESSION_EXPIRED" });
  const encoded = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON_B64");
  if (!encoded) return json(503, { error: "PUSH_NOT_CONFIGURED" });
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  try {
    const { data: events, error: claimError } = await admin.rpc(
      "claim_rexrun_notifications",
      { owner_id: user.id },
    );
    if (claimError) throw new Error("CLAIM_FAILED");
    const { data: devices, error: deviceError } = await admin.from(
      "user_devices",
    ).select("device_id,push_token,app_version").eq("user_id", user.id).eq(
      "push_enabled",
      true,
    ).not("push_token", "is", null);
    if (deviceError) throw new Error("DEVICE_READ_FAILED");
    if (!devices?.length) {
      if (events?.length) {
        await admin.from("notification_outbox").update({ status: "no_device" })
          .eq("user_id", user.id).in(
            "id",
            events.map((e: { id: string }) => e.id),
          );
      }
      return json(200, { accepted: 0, waitingForDevice: events?.length ?? 0 });
    }
    const sa = JSON.parse(atob(encoded));
    const token = await accessToken(sa);
    let accepted = 0;
    for (const event of events ?? []) {
      let delivered = false;
      const parts = (event.event_key ?? "").split(":");
      const targets = event.kind === "app_update"
        ? devices.filter((d: { app_version?: string }) =>
          d.app_version === parts[2]
        )
        : devices;
      for (const device of targets) {
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
                token: device.push_token,
                notification: { title: event.title, body: event.body },
                data: {
                  event_id: event.id,
                  kind: event.kind,
                  ...(event.kind === "app_update" ? { version: parts[3] } : {}),
                  route: event.kind === "app_update"
                    ? "/me?updates=1"
                    : "/quests",
                },
                android: {
                  ttl: "86400s",
                  collapse_key: event.id,
                  notification: {
                    tag: event.id,
                    channel_id: event.kind === "app_update"
                      ? "rexrun-updates"
                      : "rexrun-quests",
                  },
                },
              },
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (result.ok) delivered = true;
        else {
          const errorBody = await result.json().catch(() => ({}));
          if (
            errorBody.error?.details?.some((d: { errorCode?: string }) =>
              d.errorCode === "UNREGISTERED"
            )
          ) {
            await admin.from("user_devices").update({
              push_enabled: false,
              push_token: null,
            }).eq("user_id", user.id).eq("device_id", device.device_id);
          }
        }
      }
      const { error: updateError } = await admin.from("notification_outbox")
        .update({
          status: delivered ? "accepted" : "retry",
          accepted_at: delivered ? new Date().toISOString() : null,
        }).eq("user_id", user.id).eq("id", event.id);
      if (updateError) throw new Error("ACK_FAILED");
      if (delivered) accepted++;
    }
    return json(200, {
      accepted,
      claimed: events?.length ?? 0,
      delivery:
        "FCM acceptance only; physical device receipt requires device verification",
    });
  } catch {
    return json(503, { error: "PUSH_RETRY_PENDING" });
  }
});
