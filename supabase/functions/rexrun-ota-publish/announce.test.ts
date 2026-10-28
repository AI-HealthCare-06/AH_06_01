import { announceAppUpdate } from "./announce.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MobileManifest } from "../../../frontend/src/domain/mobile-update.ts";
const release = {
  channel: "galaxy-test",
  nativeVersion: "1.5.0",
  version: "1.5.7",
} as MobileManifest;
function fixture(fail = false) {
  const devices = [
    ...Array.from(
      { length: 499 },
      (_, i) => ({ user_id: "a", device_id: String(i), push_token: "a" + i }),
    ),
    { user_id: "b", device_id: "1", push_token: "b1" },
    { user_id: "b", device_id: "2", push_token: "b2" },
  ];
  const unique = new Set<string>(),
    filters: unknown[][] = [],
    acks: unknown[] = [],
    sent: string[] = [];
  const client = {
    from(table: string) {
      let pending: unknown, user = "";
      const q = {
        select() {
          return q;
        },
        eq(...args: unknown[]) {
          filters.push(args);
          return q;
        },
        not() {
          return q;
        },
        order() {
          return q;
        },
        range(start: number, end: number) {
          return Promise.resolve({
            data: devices.slice(start, end + 1),
            error: null,
          });
        },
        upsert(
          value: { user_id: string; event_key: string },
          options: unknown,
        ) {
          user = value.user_id;
          filters.push(["upsert", options]);
          const key = user + value.event_key;
          pending = unique.has(key) ? [] : [{ id: user }];
          unique.add(key);
          return q;
        },
        update(value: unknown) {
          acks.push(value);
          pending = [];
          return q;
        },
        then(resolve: (v: unknown) => void) {
          resolve({ data: pending, error: null });
        },
      };
      if (!["notification_outbox", "user_devices"].includes(table)) {
        throw Error("unexpected table");
      }
      return q;
    },
  } as unknown as SupabaseClient;
  return {
    client,
    filters,
    acks,
    sent,
    send: async (token: string) => {
      sent.push(token);
      return !fail;
    },
  };
}
Deno.test("update announcement filters compatible opted-in Android devices, groups across pages, and deduplicates per user/release", async () => {
  const f = fixture();
  await announceAppUpdate(f.client, release, f.send);
  await announceAppUpdate(f.client, release, f.send);
  if (f.sent.length !== 501 || f.acks.length !== 2) {
    throw Error("duplicate or missing delivery");
  }
  for (
    const pair of [["platform", "android"], ["app_version", "1.5.0"], [
      "push_enabled",
      true,
    ]]
  ) {
    if (
      !f.filters.some((v) => JSON.stringify(v) === JSON.stringify(pair))
    ) throw Error("missing eligibility filter");
  }
  if (!f.acks.every((v) => (v as { status: string }).status === "accepted")) {
    throw Error("missing acknowledgement");
  }
});
Deno.test("update send failures retain retryable events", async () => {
  const f = fixture(true);
  await announceAppUpdate(f.client, release, f.send);
  if (!f.acks.every((v) => (v as { status: string }).status === "retry")) {
    throw Error("retry lost");
  }
});
