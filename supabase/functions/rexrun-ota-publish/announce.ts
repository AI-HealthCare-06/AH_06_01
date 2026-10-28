import type { SupabaseClient } from "@supabase/supabase-js";
import type { MobileManifest } from "../../../frontend/src/domain/mobile-update.ts";
import { sendUpdatePush } from "../_shared/update-fcm.ts";
type Device = { user_id: string; device_id: string; push_token: string };
// Called only after authenticated promotion. The public app has no access to this function.
export async function announceAppUpdate(
  client: SupabaseClient,
  release: MobileManifest,
  send = sendUpdatePush,
) {
  const title = "REXRUN · 새 업데이트",
    body = `v${release.version} 업데이트가 준비됐어요.`;
  async function deliver(devices: Device[]) {
    if (!devices.length) return;
    const user = devices[0].user_id;
    const { data: events, error } = await client.from("notification_outbox")
      .upsert({
        user_id: user,
        event_key:
          `app-update:${release.channel}:${release.nativeVersion}:${release.version}`,
        kind: "app_update",
        title,
        body,
        status: "processing",
        claimed_at: new Date().toISOString(),
        attempts: 1,
      }, { onConflict: "user_id,event_key", ignoreDuplicates: true }).select(
        "id",
      );
    if (error) throw new Error("UPDATE_QUEUE_FAILED");
    for (const event of events ?? []) {
      let delivered = false;
      for (const d of devices) {
        try {
          if (
            await send(d.push_token, title, body, event.id, release.version)
          ) delivered = true;
        } catch { /* The outbox retains a retryable event. */ }
      }
      const { error: ackError } = await client.from("notification_outbox")
        .update({
          status: delivered ? "accepted" : "retry",
          accepted_at: delivered ? new Date().toISOString() : null,
        }).eq("id", event.id).eq("user_id", user);
      if (ackError) throw new Error("UPDATE_ACK_FAILED");
    }
  }
  let pending: Device[] = [];
  for (let offset = 0;; offset += 500) {
    const { data, error } = await client.from("user_devices").select(
      "user_id,device_id,push_token",
    ).eq("platform", "android").eq("app_version", release.nativeVersion).eq(
      "push_enabled",
      true,
    ).not("push_token", "is", null).order("user_id").order("device_id").range(
      offset,
      offset + 499,
    );
    if (error) throw new Error("UPDATE_DEVICES_FAILED");
    for (const d of (data ?? []) as Device[]) {
      if (pending.length && pending[0].user_id !== d.user_id) {
        await deliver(pending);
        pending = [];
      }
      pending.push(d);
    }
    if (!data || data.length < 500) break;
  }
  await deliver(pending);
}
