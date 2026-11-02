// Explicit opt-in: real PostgREST + concurrent requests, synthetic accounts only.
// Credentials stay in the existing ignored fixture and process memory.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { strict as assert } from "node:assert";

if (process.env.REXRUN_BP_LIVE !== "1")
  throw new Error("Set REXRUN_BP_LIVE=1 to opt in");
const root = new URL("../../", import.meta.url);
const config = JSON.parse(
  readFileSync(new URL("frontend/cloud.config.json", root)),
);
assert.equal(
  new URL(config.supabaseUrl).hostname,
  "bjyanmywcclymklgcrhi.supabase.co",
);
const fixture = JSON.parse(
  readFileSync(new URL(".cache/deployment/fixtures.private.json", root)),
);
assert.ok(/^[0-9a-f]{8}$/.test(fixture.run));
assert.equal(fixture.users.length, 2);
for (const [i, u] of fixture.users.entries())
  assert.equal(u.email, `rexrun-synthetic-${fixture.run}-${i}@example.invalid`);
let checks = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
async function request(path, token, body, method = "POST") {
  const result = await fetch(config.supabaseUrl + path, {
    method,
    headers: {
      apikey: config.publishableKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const raw = await result.text();
  return {
    status: result.status,
    ok: result.ok,
    value: raw ? JSON.parse(raw) : null,
  };
}
const rpc = (name, token, body = {}) =>
  request(`/rest/v1/rpc/${name}`, token, body);
const sessions = [];
for (const user of fixture.users) {
  const result = await request("/auth/v1/token?grant_type=password", null, {
    email: user.email,
    password: user.password,
  });
  check(
    result.ok && result.value.user?.id === user.id,
    "synthetic fixture login failed",
  );
  sessions.push(result.value.access_token);
}
const [a, b] = sessions;
for (let i = 0; i < sessions.length; i++) {
  const profile = await request(
    "/rest/v1/user_profiles?on_conflict=user_id",
    sessions[i],
    { user_id: fixture.users[i].id },
  );
  check(profile.ok, "synthetic profile prerequisite failed");
  const consent = await request(
    "/rest/v1/user_consents?on_conflict=user_id,consent_type,version",
    sessions[i],
    {
      user_id: fixture.users[i].id,
      consent_type: "health_cloud_storage",
      version: "health-cloud-v1",
      revoked_at: null,
    },
  );
  check(consent.ok, "synthetic consent prerequisite failed");
}
const date = `1900-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;
const key = `survey:${date}:morning`;
const firstHeads = await rpc("bp_history_heads", a);
check(
  firstHeads.ok && firstHeads.value.contract === "bp-history-v1",
  "heads contract failed",
);
const parent =
  firstHeads.value.records.find((r) => r.command.entry_key === key)?.command
    .mutation_id ?? null;
const command = (previous, systolic = 148) => ({
  mutation_id: randomUUID(),
  entry_key: key,
  parent_mutation_id: previous,
  value: {
    recorded_on: date,
    slot: "morning",
    status: "measured",
    systolic,
    diastolic: 94,
    unit: "mmHg",
    source: "manual-survey",
    metadata: {
      timePrecision: "day",
      measuredAt: null,
      setting: "unknown",
      method: "unknown",
      deviceLabel: null,
      protocolConfirmed: null,
    },
  },
});
const first = command(parent);
const r1 = await rpc("append_bp_history", a, { p_commands: [first] });
check(r1.ok && r1.value.acknowledgments?.length === 1, "first append failed");
const ack = r1.value.acknowledgments[0];
check(
  ack.revision > 0 &&
    Date.now() - Date.parse(ack.available_at) < 60000 &&
    Date.parse(ack.available_at) > Date.parse("2026-01-01"),
  "server receipt missing",
);
assert.deepEqual(
  (await rpc("append_bp_history", a, { p_commands: [first] })).value,
  r1.value,
);
checks++;
const concurrent = [
  command(first.mutation_id, 140),
  command(first.mutation_id, 138),
];
const replies = await Promise.all(
  concurrent.map((c) => rpc("append_bp_history", a, { p_commands: [c] })),
);
check(
  replies.filter((r) => r.ok).length === 1 &&
    replies.some(
      (r) => !r.ok && r.value.message?.includes("BP_MUTATION_CONFLICT"),
    ),
  "concurrent append was not serialized",
);
const winner = concurrent[replies.findIndex((r) => r.ok)];
const pit = await rpc("bp_history_at", a, {
  p_as_of: ack.available_at,
  p_start: date,
  p_end: date,
});
check(
  pit.ok &&
    pit.value.records.find((r) => r.command.entry_key === key)?.command.value
      .systolic === 148,
  "point-in-time reconstruction failed",
);
const other = await request(
  `/rest/v1/bp_measurement_revisions?select=mutation_id&mutation_id=eq.${first.mutation_id}`,
  b,
  undefined,
  "GET",
);
check(
  other.ok && other.value.length === 0,
  "another account could read the revision",
);
const forbidden = await request(
  `/rest/v1/bp_measurement_revisions?mutation_id=eq.${first.mutation_id}`,
  a,
  { payload: {} },
  "PATCH",
);
check(!forbidden.ok, "immutable original was editable");
const spoofed = await rpc("append_bp_history", a, {
  p_commands: [
    { ...command(winner.mutation_id), available_at: "2000-01-01T00:00:00Z" },
  ],
});
check(!spoofed.ok, "client supplied server fields accepted");
const deleted = command(winner.mutation_id);
Object.assign(deleted.value, {
  status: "deleted",
  systolic: null,
  diastolic: null,
});
check(
  (await rpc("append_bp_history", a, { p_commands: [deleted] })).ok,
  "deletion revision failed",
);
assert.deepEqual(
  (await rpc("append_bp_history", a, { p_commands: [first] })).value,
  r1.value,
);
checks++;
check(
  !(await rpc("bp_history_heads", null)).ok,
  "anonymous RPC was accessible",
);
const consentPath = `/rest/v1/user_consents?user_id=eq.${fixture.users[1].id}&consent_type=eq.health_cloud_storage&version=eq.health-cloud-v1`;
try {
  check(
    (
      await request(
        consentPath,
        b,
        { revoked_at: new Date().toISOString() },
        "PATCH",
      )
    ).ok,
    "synthetic consent withdrawal failed",
  );
  check(
    !(await rpc("bp_history_heads", b)).ok,
    "withdrawn consent still read journal",
  );
} finally {
  assert.ok(
    (await request(consentPath, b, { revoked_at: null }, "PATCH")).ok,
    "synthetic consent restoration failed",
  );
}
const result = {
  checks,
  synthetic_accounts_only: true,
  concurrent_requests_serialized: true,
  account_isolation: true,
  original_preserved: true,
  point_in_time_verified: true,
  project: "rexrun-mobile-test",
};
writeFileSync(
  new URL(".cache/deployment/bp-journal-live-result.json", root),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
