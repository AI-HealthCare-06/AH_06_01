import { test } from "node:test";
import assert from "node:assert/strict";
import { previousChannel } from "./ota-channel.mjs";

const options = {
  nativeVersion: "1.7.0",
  newNativeVersion: "1.7.0",
  channel: "galaxy-test",
  version: "1.7.4",
  sha: "a".repeat(40),
  decode: (v) => v,
};
const manifest = {
  appId: "com.rexrun.demo",
  channel: "galaxy-test",
  nativeVersion: "1.7.0",
  version: "1.7.3",
  source: { commit: "b".repeat(40) },
};
const response = (value) => Response.json(value);
test("only the current new APK may bootstrap a missing channel", async () => {
  assert.deepEqual(
    await previousChannel(new Response(null, { status: 404 }), options),
    {
      envelope: null,
      previous: null,
    },
  );
  await assert.rejects(
    () =>
      previousChannel(new Response(null, { status: 404 }), {
        ...options,
        nativeVersion: "1.5.2",
      }),
    /unavailable/,
  );
  await assert.rejects(
    () => previousChannel(new Response(null, { status: 503 }), options),
    /unavailable/,
  );
});
test("Storage's HTTP 400 NoSuchKey only bootstraps the current new APK", async () => {
  const missing = { statusCode: "404", error: "not_found", code: "NoSuchKey" };
  assert.equal(
    (await previousChannel(Response.json(missing, { status: 400 }), options))
      .previous,
    null,
  );
  await assert.rejects(
    () =>
      previousChannel(Response.json(missing, { status: 400 }), {
        ...options,
        nativeVersion: "1.5.2",
      }),
    /unavailable/,
  );
  for (const body of [
    { ...missing, code: "NoSuchBucket" },
    { ...missing, statusCode: "403" },
    {},
  ])
    await assert.rejects(
      () => previousChannel(Response.json(body, { status: 400 }), options),
      /unavailable/,
    );
  await assert.rejects(
    () => previousChannel(new Response("invalid", { status: 400 }), options),
    /unavailable/,
  );
});
test("existing channels retain signature, identity and version checks", async () => {
  assert.equal(
    (await previousChannel(response(manifest), options)).previous.version,
    "1.7.3",
  );
  for (const patch of [
    { appId: "other" },
    { channel: "other" },
    { nativeVersion: "1.5.2" },
    { version: "1.7.5" },
    { version: "1.7.4" },
  ])
    await assert.rejects(() =>
      previousChannel(response({ ...manifest, ...patch }), options),
    );
  await assert.rejects(
    () =>
      previousChannel(response(manifest), {
        ...options,
        decode: () => {
          throw new Error("invalid signature");
        },
      }),
    /invalid signature/,
  );
  const retry = {
    ...manifest,
    version: options.version,
    source: { commit: options.sha },
  };
  assert.equal(
    (await previousChannel(response(retry), options)).previous.version,
    options.version,
  );
});
