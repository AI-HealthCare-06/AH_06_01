import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  createHandler,
  type RecordItem,
  type RequestEvent,
  type TestEvent,
} from "../collector/core.js";

const date = "2026-10-19T00:00:00.000Z";
const sample: TestEvent = {
  schemaVersion: 1,
  eventId: "12345678-1234-1234-1234-123456789012",
  sentAt: date,
  source: "android",
  eventType: "connection_probe",
  synthetic: true,
  payload: { sample: 1 },
};
function setup() {
  const records = new Map<string, RecordItem>();
  const handler = createHandler(
    {
      async putIfAbsent(item) {
        const k = `${item.owner}/${item.eventId}`;
        if (records.has(k)) return false;
        records.set(k, item);
        return true;
      },
      async get(owner, id) {
        return records.get(`${owner}/${id}`);
      },
    },
    () => new Date(date),
  );
  const req = (
    body: unknown = sample,
    owner = "arn:aws:iam::123456789012:user/test",
  ): RequestEvent => ({
    rawPath: "/v1/test-events",
    body: JSON.stringify(body),
    requestContext: {
      http: { method: "POST" },
      authorizer: owner ? { iam: { userArn: owner } } : undefined,
    },
  });
  return { handler, records, req };
}
test("accept, read back and deduplicate a synthetic event without overwriting it", async () => {
  const { handler, req, records } = setup();
  assert.equal((await handler(req())).statusCode, 201);
  assert.equal((await handler(req())).statusCode, 200);
  assert.equal(records.size, 1);
  assert.equal(
    (await handler(req({ ...sample, source: "web" }))).statusCode,
    409,
  );
  const read = req();
  read.rawPath += `/${sample.eventId}`;
  read.requestContext.http.method = "GET";
  assert.deepEqual(JSON.parse((await handler(read)).body).event, sample);
  read.requestContext.authorizer = { iam: { userArn: "another-user" } };
  assert.equal((await handler(read)).statusCode, 404);
});
test("reject unauthenticated, health fields, invalid timestamps, malformed and oversized bodies", async () => {
  const { handler, req, records } = setup();
  assert.equal((await handler(req(sample, ""))).statusCode, 401);
  for (const body of [
    { ...sample, name: "reject" },
    { ...sample, payload: { bloodPressure: 120 } },
    { ...sample, synthetic: false },
    { ...sample, sentAt: "invalid" },
    { ...sample, sentAt: "2026-09-01T00:00:00.000Z" },
  ])
    assert.equal((await handler(req(body))).statusCode, 422);
  assert.equal((await handler({ ...req(), body: "{" })).statusCode, 400);
  assert.equal(
    (await handler({ ...req(), body: "x".repeat(4097) })).statusCode,
    400,
  );
  assert.equal(records.size, 0);
});
test("storage failures return a retryable error without reflecting secrets or inputs", async () => {
  const handler = createHandler(
    {
      async putIfAbsent() {
        throw new Error("do not expose");
      },
      async get() {
        return undefined;
      },
    },
    () => new Date(date),
  );
  const result = await handler(setup().req());
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.includes("do not expose"), false);
});
test("real local HTTP round trip reaches the collector and returns the stored record", async () => {
  const { handler } = setup();
  const server = createServer(async (incoming, outgoing) => {
    const buffers: Buffer[] = [];
    for await (const part of incoming) buffers.push(Buffer.from(part));
    const result = await handler({
      rawPath: incoming.url ?? "/",
      body: Buffer.concat(buffers).toString(),
      requestContext: {
        http: { method: incoming.method ?? "GET" },
        authorizer: { iam: { userArn: "local-test-only" } },
      },
    });
    outgoing.writeHead(result.statusCode, result.headers);
    outgoing.end(result.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const post = await fetch(`${base}/v1/test-events`, {
      method: "POST",
      body: JSON.stringify(sample),
    });
    assert.equal(post.status, 201);
    await post.arrayBuffer();
    const get = await fetch(`${base}/v1/test-events/${sample.eventId}`);
    assert.equal(get.status, 200);
    assert.deepEqual(
      ((await get.json()) as { event: TestEvent }).event,
      sample,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
