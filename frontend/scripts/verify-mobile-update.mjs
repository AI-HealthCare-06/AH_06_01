import { createHash, sign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMobileManifest, updateBaseUrl } from "../src/domain/mobile-update.ts";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(readFileSync(resolve(frontend, "mobile-updates.config.json"), "utf8"));
const base = updateBaseUrl(config);
const latestUrl = `${base}/android/${config.channel}/${config.nativeVersion}/latest.json`;
const endpoint = `${config.projectUrl}/functions/v1/rexrun-ota-publish`;
const response = await fetch(`${latestUrl}?t=${Date.now()}`, {
  cache: "no-store",
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Channel unavailable: ${response.status}`);
const envelope = await response.json();
const release = await verifyMobileManifest(envelope, config, config.nativeVersion);
const unique = [...new Map(release.files.map((file) => [file.file_hash, file])).values()];
let next = 0;
let checked = 0;
let downloadedBytes = 0;
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < unique.length) {
      const file = unique[next++];
      const response = await fetch(file.download_url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`File unavailable: ${file.file_name} (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.length !== file.size ||
        createHash("sha256").update(bytes).digest("hex") !== file.file_hash
      )
        throw new Error(`File integrity failure: ${file.file_name}`);
      downloadedBytes += bytes.length;
      checked++;
      if (checked % 50 === 0 || checked === unique.length)
        console.log(`원격 파일 검증 ${checked}/${unique.length}`);
    }
  }),
);

const report = {
  projectUrl: config.projectUrl,
  channel: config.channel,
  nativeVersion: release.nativeVersion,
  webVersion: release.version,
  signatureVerified: true,
  files: release.files.length,
  uniqueFiles: unique.length,
  verifiedBytes: downloadedBytes,
  checkedAt: new Date().toISOString(),
};
if (process.argv.includes("--check-access")) {
  const publicKey = JSON.parse(
    readFileSync(resolve(frontend, ".cache/mobile-updates/public-test-key.json"), "utf8"),
  ).key;
  const publicSettings = await fetch(`${config.projectUrl}/auth/v1/settings`, {
    headers: { apikey: publicKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!publicSettings.ok)
    throw new Error(`Publishable key validation failed: ${publicSettings.status}`);
  const anonymous = await fetch(
    `${config.projectUrl}/storage/v1/object/${config.bucket}/checks/anonymous-write-probe-${Date.now()}.txt`,
    {
      method: "POST",
      headers: { apikey: publicKey, "Content-Type": "application/octet-stream" },
      body: "REXRUN authorization probe; expected to be rejected.",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const anonymousError = await anonymous.json().catch(() => ({}));
  const storageDenied =
    Number(anonymousError.statusCode) === 403 && anonymousError.code === "AccessDenied";
  if (anonymous.ok || !(anonymous.status === 403 || (anonymous.status === 400 && storageDenied)))
    throw new Error(`Anonymous write was not denied by the access policy: ${anonymous.status}`);
  const unsigned = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (unsigned.status !== 401)
    throw new Error(`Unsigned publisher request not rejected: ${unsigned.status}`);
  const reusedManifest = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(envelope),
    signal: AbortSignal.timeout(30_000),
  });
  if (reusedManifest.status !== 401)
    throw new Error("A public manifest was accepted as publisher authentication");
  const privateKey = readFileSync(
    process.env.REXRUN_OTA_PRIVATE_KEY_PATH ||
      resolve(frontend, ".cache/mobile-updates/publisher-key.pem"),
  );
  const signed = (value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return {
      payload: bytes.toString("base64"),
      signature: sign("sha256", bytes, privateKey).toString("base64"),
    };
  };
  const missingHash = "f".repeat(64);
  if (unique.some((file) => file.file_hash === missingHash))
    throw new Error("Choose a different missing-file test hash");
  const missingRelease = signed({
    ...release,
    version: release.version
      .split(".")
      .map((part, i) => (i === 2 ? Number(part) + 1 : Number(part)))
      .join("."),
    publishedAt: new Date().toISOString(),
    files: [
      {
        file_name: "index.html",
        file_hash: missingHash,
        download_url: `${base}/files/${missingHash}`,
        size: 1,
      },
    ],
  });
  const incomplete = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      signed({
        purpose: "rexrun-ota-publish",
        action: "activate",
        issuedAt: Date.now(),
        release: missingRelease,
        hashes: [],
      }),
    ),
    signal: AbortSignal.timeout(30_000),
  });
  if (incomplete.status !== 409)
    throw new Error(`Incomplete release not rejected: ${incomplete.status}`);
  const after = await fetch(`${latestUrl}?t=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const unchanged = await after.json();
  if (unchanged.payload !== envelope.payload || unchanged.signature !== envelope.signature)
    throw new Error("An incomplete upload changed the active channel");
  Object.assign(report, {
    publishableKeyValid: true,
    anonymousWriteDenied: true,
    anonymousWriteHttpStatus: anonymous.status,
    anonymousWriteStorageStatus: Number(anonymousError.statusCode) || anonymous.status,
    unsignedPublisherDenied: unsigned.status,
    manifestReplayDenied: reusedManifest.status,
    incompleteReleaseDenied: incomplete.status,
    channelUnchanged: true,
  });
}
const reportPath = resolve(frontend, ".cache/mobile-updates/verification.json");
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
