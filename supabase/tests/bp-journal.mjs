// Isolated PostgreSQL/WASM integration tests. Never reads a hosted project.
// Tool dependency: npm install --prefix .cache/bp-journal-tools --no-save @electric-sql/pglite@0.5.14
import { readFile, readdir, writeFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { PGlite } from "../../.cache/bp-journal-tools/node_modules/@electric-sql/pglite/dist/index.js";
const db = new PGlite();
process.on("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});
let checks = 0;
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
insert into auth.users values('${A}'),('${B}');`);
for (const name of (await readdir(new URL("../migrations/", import.meta.url)))
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  await db.exec(
    await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
  );
}
await db.exec(`insert into public.user_profiles(user_id) values('${A}'),('${B}');
insert into public.user_consents(user_id,consent_type,version) values('${A}','health_cloud_storage','health-cloud-v1'),('${B}','health_cloud_storage','health-cloud-v1');`);
const day = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date(Date.now() - 86400000));
const metadata = {
  timePrecision: "day",
  measuredAt: null,
  setting: "unknown",
  method: "unknown",
  deviceLabel: null,
  protocolConfirmed: null,
};
const command = (slot = "morning", parent = null, patch = {}) => ({
  mutation_id: randomUUID(),
  entry_key: `survey:${day}:${slot}`,
  parent_mutation_id: parent,
  value: {
    recorded_on: day,
    slot,
    status: "measured",
    systolic: 148,
    diastolic: 94,
    unit: "mmHg",
    source: "manual-survey",
    metadata,
    ...patch,
  },
});
async function as(role, owner) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner ?? "",
  ]);
  await db.exec(`set role ${role}`);
}
const append = async (commands) =>
  (
    await db.query("select public.append_bp_history($1::jsonb) result", [
      JSON.stringify(commands),
    ])
  ).rows[0].result;
const count = async () =>
  Number(
    (await db.query("select count(*) n from public.bp_measurement_revisions"))
      .rows[0].n,
  );
async function rejects(fn, pattern = /BP_|permission denied/) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error, "expected SQL rejection");
  assert.match(error.message, pattern);
  checks++;
}
await as("authenticated", A);
const first = command(),
  r1 = await append([first]);
checks++;
assert.equal(r1.acknowledgments[0].revision, 1);
assert.ok(
  Date.parse(r1.acknowledgments[0].available_at) >
    Date.parse(day + "T23:59:59+09:00"),
);
checks++;
assert.deepEqual(await append([first]), r1);
assert.equal(await count(), 1);
checks++;
await rejects(
  () => append([{ ...first, value: { ...first.value, systolic: 149 } }]),
  /BP_MUTATION_ID_REUSE/,
);
const second = command("morning", first.mutation_id, {
  systolic: 142,
  diastolic: 90,
});
const r2 = await append([second]);
assert.equal(r2.acknowledgments[0].revision, 2);
checks++;
await rejects(
  () => append([command("morning", first.mutation_id)]),
  /BP_MUTATION_CONFLICT/,
);
const at = async (cutoff) =>
  (
    await db.query("select public.bp_history_at($1,$2,$2) result", [
      cutoff,
      day,
    ])
  ).rows[0].result.records;
assert.equal(
  (await at(r1.acknowledgments[0].available_at))[0].command.value.systolic,
  148,
);
checks++;
assert.equal(
  (await at(r2.acknowledgments[0].available_at))[0].command.value.systolic,
  142,
);
checks++;
const deleted = command("morning", second.mutation_id, {
  status: "deleted",
  systolic: null,
  diastolic: null,
});
const r3 = await append([deleted]);
assert.equal(r3.acknowledgments[0].revision, 3);
assert.equal(await count(), 3);
checks++;
assert.equal(
  (await at(r1.acknowledgments[0].available_at))[0].command.value.status,
  "measured",
);
checks++;
const latest = (await db.query("select public.bp_history_heads() result"))
  .rows[0].result.records;
assert.equal(latest[0].command.value.status, "deleted");
checks++;
assert.deepEqual(await append([first]), r1);
assert.equal(await count(), 3);
checks++;
await rejects(
  () =>
    db.query(
      "select public.bp_history_at(clock_timestamp()+interval '1 day',$1,$1)",
      [day],
    ),
  /BP_INVALID_RANGE/,
);
await rejects(
  () =>
    db.query(
      "select public.bp_history_at(clock_timestamp(),'2000-01-01','2026-01-01')",
    ),
  /BP_INVALID_RANGE/,
);
await rejects(() =>
  db.query("update public.bp_measurement_revisions set payload='{}'"),
);
await rejects(() => db.query("delete from public.bp_measurement_revisions"));
await rejects(() =>
  db.query(
    "insert into public.bp_measurement_revisions(entry_key,mutation_id,payload,available_at) values($1,$2,$3,'2000-01-01')",
    [first.entry_key, randomUUID(), first.value],
  ),
);
await rejects(() =>
  db.query(
    "insert into public.bp_measurement_revisions(user_id,entry_key,mutation_id,payload) values($1,$2,$3,$4)",
    [B, first.entry_key, randomUUID(), first.value],
  ),
);
await rejects(() =>
  append([{ ...command("evening"), available_at: "2000-01-01T00:00:00Z" }]),
);
for (const patch of [
  { slot: null },
  { status: null },
  { source: null },
  { systolic: 80, diastolic: 120 },
  { systolic: 148.5 },
  { unit: "kPa" },
  { metadata: { ...metadata, setting: null } },
  { metadata: { ...metadata, timePrecision: null } },
  { metadata: { ...metadata, deviceLabel: 12 } },
  { metadata: { ...metadata, protocolConfirmed: "yes" } },
  { source: "legacy-survey", metadata: { ...metadata, setting: "home" } },
  {
    metadata: {
      ...metadata,
      timePrecision: "minute",
      measuredAt: day + "T08:00:00",
    },
  },
]) {
  await rejects(() => append([command("evening", null, patch)]));
}
await rejects(() => db.query("select public.bp_history_heads('',null)"));
await rejects(() => db.query("select public.bp_history_heads('',201)"));
const before = await count();
await rejects(
  () => append([command("evening"), command("morning", first.mutation_id)]),
  /BP_MUTATION_CONFLICT/,
);
assert.equal(await count(), before);
checks++;
const precise = command("evening", null, {
  metadata: {
    ...metadata,
    timePrecision: "minute",
    measuredAt: day + "T20:00:00+09:00",
    setting: "home",
    method: "upper-arm-cuff",
    deviceLabel: "test-cuff",
    protocolConfirmed: true,
  },
});
await append([precise]);
checks++;
const page1 = (await db.query("select public.bp_history_heads('',1) result"))
  .rows[0].result.records;
const page2 = (
  await db.query("select public.bp_history_heads($1,1) result", [
    page1[0].command.entry_key,
  ])
).rows[0].result.records;
assert.equal(page1.length, 1);
assert.equal(page2.length, 1);
assert.ok(page1[0].command.entry_key < page2[0].command.entry_key);
checks++;
await as("authenticated", B);
assert.equal(await count(), 0);
checks++;
await append([command()]);
assert.equal(await count(), 1);
checks++;
const own = (await db.query("select public.bp_history_heads() result")).rows[0]
  .result.records;
assert.equal(own.length, 1);
assert.notEqual(own[0].command.mutation_id, first.mutation_id);
checks++;
await as("anon", null);
await rejects(() => append([command()]));
await rejects(() => count());
await as("authenticated", null);
await rejects(() => append([command()]), /BP_AUTH_REQUIRED/);
await as("postgres", null);
await db.query(
  "update public.user_consents set revoked_at=now() where user_id=$1",
  [A],
);
await as("authenticated", A);
assert.equal(await count(), 0);
checks++;
await rejects(() => append([command()]), /BP_CONSENT_REQUIRED/);
await rejects(
  () => db.query("select public.bp_history_heads()"),
  /BP_CONSENT_REQUIRED/,
);
await as("postgres", null);
const security = (
  await db.query(
    "select c.relrowsecurity, (select bool_and(not prosecdef) from pg_proc where proname in ('append_bp_history','bp_history_heads','bp_history_at','validate_bp_revision_insert')) invoker from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relname='bp_measurement_revisions' and n.nspname='public'",
  )
).rows[0];
assert.deepEqual(security, { relrowsecurity: true, invoker: true });
checks++;
let exported = 0;
if (process.env.REXRUN_BP_COMMANDS) {
  const input = JSON.parse(
    await readFile(process.env.REXRUN_BP_COMMANDS, "utf8"),
  );
  assert.equal(
    input.synthetic,
    true,
    "this verification path accepts generated synthetic commands only",
  );
  await db.query(
    "update public.user_consents set revoked_at=null where user_id=$1",
    [A],
  );
  await as("authenticated", A);
  const ack = await append(input.commands);
  assert.equal(ack.acknowledgments.length, input.commands.length);
  checks++;
  const rows = (
    await db.query(
      "select jsonb_build_object('command',jsonb_build_object('mutation_id',mutation_id,'entry_key',entry_key,'parent_mutation_id',parent_mutation_id,'value',payload),'revision',revision,'available_at',available_at) r from public.bp_measurement_revisions order by entry_key,revision",
    )
  ).rows
    .map((r) => r.r)
    .filter((r) =>
      input.commands.some((c) => c.mutation_id === r.command.mutation_id),
    );
  exported = rows.length;
  if (process.env.REXRUN_BP_SERVER_EXPORT)
    await writeFile(
      process.env.REXRUN_BP_SERVER_EXPORT,
      JSON.stringify(
        { synthetic: true, contract: "bp-history-v1", records: rows },
        null,
        2,
      ),
    );
}
await db.close();
console.log(
  JSON.stringify({
    checks,
    exported,
    postgres_wasm: true,
    hosted_project_accessed: false,
    multi_connection_concurrency_tested: false,
  }),
);
