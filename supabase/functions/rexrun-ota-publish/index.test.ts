import { createPublisherHandler } from "./index.ts";

const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};
const pair = await crypto.subtle.generateKey(algorithm, true, [
  "sign",
  "verify",
]);
const base64 = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)));
const config = {
  projectUrl: "https://abcdefghijklmnopqrst.supabase.co",
  publicKey: base64(await crypto.subtle.exportKey("spki", pair.publicKey)),
  bucket: "rexrun-app-updates",
  channel: "galaxy-test",
  nativeVersion: "1.1.0",
};
const handle = createPublisherHandler(config);
async function signed(data: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return {
    payload: base64(bytes),
    signature: base64(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, bytes),
    ),
  };
}
async function post(data: unknown, target = handle) {
  return target(
    new Request("https://test.invalid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  );
}
function equal(actual: number, expected: number) {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

Deno.test("publisher rejects GET without performing storage writes", async () =>
  equal((await handle(new Request("https://test.invalid"))).status, 405));
Deno.test("publisher rejects unsigned requests", async () =>
  equal((await post({ action: "prepare" })).status, 401));
Deno.test("publisher rejects forged signatures", async () =>
  equal(
    (await post({ payload: btoa("{}"), signature: btoa("invalid") })).status,
    401,
  ));
Deno.test("a public app manifest is not a publisher credential", async () =>
  equal(
    (await post(
      await signed({ schema: 1, appId: "com.rexrun.demo", version: "1.1.1" }),
    )).status,
    401,
  ));
Deno.test("publisher rejects expired signed requests", async () => {
  const release = await signed({ schema: 1 });
  equal(
    (await post(
      await signed({
        purpose: "rexrun-ota-publish",
        action: "prepare",
        issuedAt: Date.now() - 11 * 60_000,
        release,
        hashes: [],
      }),
    )).status,
    401,
  );
});
Deno.test("publisher rejects a release intended for another native APK", async () => {
  const hash = "a".repeat(64);
  const release = await signed({
    schema: 1,
    appId: "com.rexrun.demo",
    platform: "android",
    channel: "galaxy-test",
    nativeVersion: "9.0.0",
    version: "9.0.1",
    publishedAt: "2026-10-15T00:00:00.000Z",
    files: [{
      file_name: "index.html",
      file_hash: hash,
      download_url:
        `${config.projectUrl}/storage/v1/object/public/${config.bucket}/files/${hash}`,
      size: 1,
    }],
  });
  equal(
    (await post(
      await signed({
        purpose: "rexrun-ota-publish",
        action: "prepare",
        issuedAt: Date.now(),
        release,
        hashes: [],
      }),
    )).status,
    400,
  );
});

for (const nativeVersion of ["1.1.0", "1.2.0", "1.2.1", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.5.2"]) {
  Deno.test(`publisher accepts the explicitly supported ${nativeVersion} channel before storage setup`, async () => {
    const hash = "a".repeat(64);
    const release = await signed({
      schema: 1, appId: "com.rexrun.demo", platform: "android", channel: "galaxy-test",
      nativeVersion, version: "1.2.3", publishedAt: "2026-10-19T00:00:00.000Z",
      files: [{file_name:"index.html", file_hash:hash, size:1,
        download_url:`${config.projectUrl}/storage/v1/object/public/${config.bucket}/files/${hash}`}],
    });
    const request = await signed({purpose:"rexrun-ota-publish", action:"prepare", issuedAt:Date.now(), release, hashes:[]});
    // Valid signatures/versions pass validation. No storage credentials are supplied by this test.
    equal((await post(request, createPublisherHandler(config, ["1.1.0", "1.2.0", "1.2.1", "1.3.0", "1.4.0", "1.5.0", "1.5.1", "1.5.2"]))).status, 503);
  });
}
