import { spawnSync } from "node:child_process";
import { createHash, createPublicKey, sign, verify } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  assertMainSource,
  assertPublicFile,
  compareVersion,
  git,
  repository,
} from "./source.mjs";
import { nativeIdentity } from "../frontend/scripts/mobile-update-native.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = join(root, "frontend");
const config = JSON.parse(
  readFileSync(join(root, "deployment/production.json")),
);
const mobile = JSON.parse(
  readFileSync(join(frontend, "mobile-updates.config.json")),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = nativeIdentity(frontend, { canonical: true });
if (
  identity.nativeVersion !== config.nativeVersion ||
  mobile.nativeVersion !== config.nativeVersion ||
  identity.fingerprint !== config.nativeFingerprint
)
  throw new Error(
    "Native compatibility changed: review APK version and OTA compatibility before release",
  );
if (process.argv.includes("--validate-config")) {
  console.log(
    JSON.stringify({
      nativeVersion: identity.nativeVersion,
      nativeCompatibility: "verified",
    }),
  );
} else {
  await publish();
}

function run(command, args, env = process.env, capture = false) {
  const r = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    windowsHide: true,
    stdio: capture ? "pipe" : "inherit",
  });
  if (r.error || r.status !== 0)
    throw new Error(`${command} failed (${r.status})`);
  return capture ? r.stdout.trim() : undefined;
}
async function get(url) {
  return fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
}
async function verifyDownload(url, expected) {
  const response = await get(url);
  if (
    !response.ok ||
    hash(Buffer.from(await response.arrayBuffer())) !== expected
  )
    throw new Error(
      `Published file verification failed: ${new URL(url).pathname}`,
    );
}
function listFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error("Symlink in public output");
    const path = join(folder, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
function freshMain(sha, generated = false) {
  git(root, "fetch", "origin", "main");
  return assertMainSource(root, { expectedSha: sha, generated });
}

async function publish() {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main" ||
    process.env.GITHUB_REPOSITORY !== repository
  )
    throw new Error(
      "Production release must run in this repository's main GitHub Actions workflow",
    );
  const sha = process.env.REXRUN_SOURCE_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || ""))
    throw new Error("Missing source commit");
  freshMain(sha);
  const number = process.env.REXRUN_RELEASE_NUMBER;
  if (!/^[1-9]\d*$/.test(number || ""))
    throw new Error("Missing release sequence");
  const version = `${config.releaseLine}.${number}`;
  compareVersion(version, "0.0.0");
  const aws = (...args) =>
    run(
      "aws",
      [...args, "--region", config.region, "--output", "json"],
      process.env,
      true,
    );
  if (JSON.parse(aws("sts", "get-caller-identity")).Account !== config.account)
    throw new Error("Unexpected AWS account");
  // No secret is logged, passed on the command line, or included in an artifact.
  if (!process.env.REXRUN_SIGNING_BUNDLE)
    throw new Error("Configure production REXRUN_SIGNING_BUNDLE first");
  const bundle = JSON.parse(process.env.REXRUN_SIGNING_BUNDLE);
  delete process.env.REXRUN_SIGNING_BUNDLE;
  for (const field of [
    "keystoreBase64",
    "password",
    "alias",
    "legacyBase64",
    "lineageBase64",
    "otaPrivateKey",
  ])
    if (typeof bundle[field] !== "string" || !bundle[field])
      throw new Error(`Missing signing field: ${field}`);
  const publicKey = createPublicKey(bundle.otaPrivateKey);
  if (
    publicKey.export({ type: "spki", format: "der" }).toString("base64") !==
    mobile.publicKey
  )
    throw new Error("OTA signing key does not match installed apps");
  const signed = (value) => {
    const payload = Buffer.from(JSON.stringify(value));
    return {
      payload: payload.toString("base64"),
      signature: sign("sha256", payload, bundle.otaPrivateKey).toString(
        "base64",
      ),
    };
  };
  const decode = (envelope) => {
    const payload = Buffer.from(envelope.payload, "base64");
    if (
      !verify(
        "sha256",
        payload,
        publicKey,
        Buffer.from(envelope.signature, "base64"),
      )
    )
      throw new Error("Existing OTA signature is invalid");
    return JSON.parse(payload);
  };
  const base = `${mobile.projectUrl}/storage/v1/object/public/${mobile.bucket}`;
  const channels = [];
  for (const nativeVersion of config.compatibleNativeVersions) {
    const url = `${base}/android/${mobile.channel}/${nativeVersion}/latest.json`;
    const response = await get(`${url}?t=${Date.now()}`);
    if (!response.ok)
      throw new Error(`Existing native channel unavailable: ${nativeVersion}`);
    const envelope = await response.json(),
      previous = decode(envelope);
    if (
      previous.nativeVersion !== nativeVersion ||
      previous.channel !== mobile.channel ||
      previous.appId !== "com.rexrun.demo"
    )
      throw new Error("Existing OTA channel identity mismatch");
    if (
      compareVersion(version, previous.version) < 0 ||
      (version === previous.version && previous.source?.commit !== sha)
    )
      throw new Error("Release cannot replace a newer or unrelated version");
    channels.push({ nativeVersion, url, envelope, previous });
  }
  const temp = mkdtempSync(join(tmpdir(), "rexrun-signing-"));
  try {
    const secretFile = (name, bytes) => {
      const path = join(temp, name);
      writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
      return path;
    };
    const env = {
      ...process.env,
      VITE_REXRUN_WEB_VERSION: version,
      REXRUN_RELEASE_STORE_FILE: secretFile(
        "release.jks",
        Buffer.from(bundle.keystoreBase64, "base64"),
      ),
      REXRUN_RELEASE_STORE_PASSWORD: bundle.password,
      REXRUN_RELEASE_KEY_PASSWORD: bundle.password,
      REXRUN_RELEASE_KEY_ALIAS: bundle.alias,
      REXRUN_LEGACY_STORE_FILE: secretFile(
        "legacy.keystore",
        Buffer.from(bundle.legacyBase64, "base64"),
      ),
      REXRUN_SIGNING_LINEAGE_FILE: secretFile(
        "signing.lineage",
        Buffer.from(bundle.lineageBase64, "base64"),
      ),
    };
    run("node", ["frontend/scripts/build-android-test.mjs"], env);
    const apkReport = JSON.parse(
      readFileSync(join(root, ".cache/mobile/firebase/build-report.json")),
    );
    if (
      apkReport.webVersion !== version ||
      apkReport.nativeVersion !== config.nativeVersion ||
      apkReport.legacyFingerprint !== config.legacyCertificate
    )
      throw new Error("APK signing or version report mismatch");
    const apk = readFileSync(apkReport.apk);
    if (hash(apk) !== apkReport.sha256) throw new Error("APK hash mismatch");
    const files = listFiles(join(frontend, "dist"))
      .map((path) => {
        const file_name = relative(join(frontend, "dist"), path).replaceAll(
          "\\",
          "/",
        );
        assertPublicFile(file_name);
        const bytes = readFileSync(path);
        if (bytes.length > 45 * 1024 * 1024)
          throw new Error("OTA file exceeds server limit");
        const file_hash = hash(bytes);
        return {
          file_name,
          file_hash,
          download_url: `${base}/files/${file_hash}`,
          size: bytes.length,
          path,
        };
      })
      .sort((a, b) => a.file_name.localeCompare(b.file_name, "en"));
    const publicFiles = files.map(({ path: _path, ...file }) => file);
    const runUrl = `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    const source = { repository, branch: "main", commit: sha, runUrl };
    for (const channel of channels) {
      if (version === channel.previous.version) {
        if (
          JSON.stringify(channel.previous.files) !== JSON.stringify(publicFiles)
        )
          throw new Error(
            "Retry built different files for an already activated version; start a new workflow run",
          );
        channel.release = channel.envelope;
      } else {
        channel.release = signed({
          schema: 1,
          appId: "com.rexrun.demo",
          platform: "android",
          channel: mobile.channel,
          nativeVersion: channel.nativeVersion,
          version,
          publishedAt: new Date().toISOString(),
          files: publicFiles,
          source,
        });
      }
    }
    async function request(channel, action, hashes = []) {
      const response = await fetch(
        `${mobile.projectUrl}/functions/v1/rexrun-ota-publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            signed({
              purpose: "rexrun-ota-publish",
              action,
              issuedAt: Date.now(),
              release: channel.release,
              hashes,
            }),
          ),
          signal: AbortSignal.timeout(120_000),
        },
      );
      if (!response.ok)
        throw new Error(`OTA ${action} failed (${response.status})`);
      return response.json();
    }
    const unique = [
      ...new Map(files.map((file) => [file.file_hash, file])).values(),
    ];
    for (let i = 0; i < unique.length; i += 12) {
      const batch = unique.slice(i, i + 12);
      const plan = await request(
        channels[0],
        "prepare",
        batch.map((file) => file.file_hash),
      );
      if (
        !Array.isArray(plan.uploads) ||
        plan.uploads.length !== batch.length ||
        new Set(plan.uploads.map((item) => item.hash)).size !== batch.length
      )
        throw new Error("Invalid OTA upload plan");
      await Promise.all(
        plan.uploads.map(async (item) => {
          const file = batch.find((entry) => entry.file_hash === item.hash);
          if (!file) throw new Error("Unexpected upload hash");
          if (!item.exists) {
            const destination = new URL(item.signedUrl);
            if (
              destination.origin !== mobile.projectUrl ||
              destination.username ||
              destination.password ||
              destination.pathname !==
                `/storage/v1/object/upload/sign/${mobile.bucket}/files/${item.hash}`
            )
              throw new Error("Untrusted OTA upload URL");
            const response = await fetch(destination, {
              method: "PUT",
              headers: { "Content-Type": "application/octet-stream" },
              body: readFileSync(file.path),
              signal: AbortSignal.timeout(120_000),
            });
            if (!response.ok)
              throw new Error(`OTA upload failed (${response.status})`);
          }
          await verifyDownload(file.download_url, file.file_hash);
        }),
      );
      console.log(
        `OTA files verified: ${Math.min(i + batch.length, unique.length)}/${unique.length}`,
      );
    }
    const apkName = `rexrun-${config.nativeVersion}-${apkReport.versionCode}-${sha.slice(0, 12)}-${apkReport.sha256.slice(0, 12)}.apk`;
    const apkUrl = `${config.origin}/downloads/${apkName}`;
    aws(
      "s3",
      "cp",
      apkReport.apk,
      `s3://${config.bucket}/downloads/${apkName}`,
      "--content-type",
      "application/vnd.android.package-archive",
      "--cache-control",
      "public,max-age=31536000,immutable",
      "--no-progress",
    );
    await verifyDownload(apkUrl, apkReport.sha256);
    // Retain previous downloads and assets so installed releases continue to work.
    aws(
      "s3",
      "sync",
      join(frontend, "dist"),
      `s3://${config.bucket}/`,
      "--exclude",
      "*.html",
      "--cache-control",
      "public,max-age=86400",
      "--no-progress",
    );
    freshMain(sha, true);
    for (const channel of channels) {
      if (version !== channel.previous.version)
        await request(channel, "activate");
      const response = await get(`${channel.url}?t=${Date.now()}`),
        saved = await response.json();
      if (
        !response.ok ||
        saved.payload !== channel.release.payload ||
        saved.signature !== channel.release.signature
      )
        throw new Error("Activated OTA channel verification failed");
    }
    const report = {
      schema: 1,
      version,
      nativeVersion: config.nativeVersion,
      versionCode: apkReport.versionCode,
      source,
      apkUrl,
      apkSha256: apkReport.sha256,
      apkBytes: apk.length,
      compatibleNativeVersions: config.compatibleNativeVersions,
      installUrl: `${config.origin}/install/index.html`,
      publishedAt: new Date().toISOString(),
    };
    const output = join(root, ".cache/production-release");
    mkdirSync(output, { recursive: true });
    writeFileSync(
      join(output, "release.json"),
      JSON.stringify(report, null, 2),
    );
    writeFileSync(join(output, "install.html"), installPage(report));
    for (const path of files.filter((file) => file.file_name.endsWith(".html")))
      aws(
        "s3",
        "cp",
        path.path,
        `s3://${config.bucket}/${path.file_name}`,
        "--content-type",
        "text/html; charset=utf-8",
        "--cache-control",
        "no-cache",
        "--no-progress",
      );
    aws(
      "s3",
      "cp",
      join(output, "install.html"),
      `s3://${config.bucket}/install/index.html`,
      "--content-type",
      "text/html; charset=utf-8",
      "--cache-control",
      "no-cache",
      "--no-progress",
    );
    aws(
      "s3",
      "cp",
      join(output, "release.json"),
      `s3://${config.bucket}/release.json`,
      "--content-type",
      "application/json",
      "--cache-control",
      "no-cache",
      "--no-progress",
    );
    const invalidation = JSON.parse(
      aws(
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        config.distribution,
        "--paths",
        "/*",
      ),
    );
    aws(
      "cloudfront",
      "wait",
      "invalidation-completed",
      "--distribution-id",
      config.distribution,
      "--id",
      invalidation.Invalidation.Id,
    );
    await verifyDownload(
      `${config.origin}/release.json?t=${Date.now()}`,
      hash(readFileSync(join(output, "release.json"))),
    );
    await verifyDownload(
      report.installUrl,
      hash(readFileSync(join(output, "install.html"))),
    );
    await verifyDownload(
      `${config.origin}/index.html`,
      hash(readFileSync(join(frontend, "dist/index.html"))),
    );
    console.log(JSON.stringify(report, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY)
      writeFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Released **${version}** from [main ${sha.slice(0, 12)}](https://github.com/${repository}/commit/${sha}).\n\n[Install APK](${report.installUrl}) · [Release provenance](${config.origin}/release.json)\n`,
      );
  } finally {
    // Only remove this process's explicitly created temporary signing directory.
    if (
      !temp.startsWith(resolve(tmpdir()) + sep) ||
      !temp.split(sep).at(-1).startsWith("rexrun-signing-")
    )
      throw new Error("Unexpected signing temporary path");
    rmSync(temp, { recursive: true, force: true });
  }
}

function installPage(report) {
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>REXRUN 설치</title>
<style>body{margin:0;background:#272c27;color:#20382f;font:18px system-ui,sans-serif;line-height:1.6}main{max-width:560px;margin:32px auto;padding:28px;background:#f3e8c8;border:3px solid #151b16;box-shadow:6px 6px #111}h1{margin:0 0 12px;font-size:36px}a{color:#175b4a}.download{display:block;padding:18px;text-align:center;background:#e54639;color:#fff;text-decoration:none;font-weight:800;border:2px solid #20382f;box-shadow:4px 4px #20382f}img{display:block;max-width:220px;width:65%;margin:24px auto}small{display:block;overflow-wrap:anywhere;margin-top:12px}@media(max-width:620px){main{margin:16px;padding:24px}}</style>
<main><h1>REXRUN</h1><p>Android 앱 · v${report.nativeVersion}<br>웹 업데이트 v${report.version}</p><a class="download" href="${report.apkUrl}">최신 APK 다운로드</a><img src="/install/install-qr.png" alt="설치 페이지 QR"><p>다운로드한 APK를 열어 설치해 주세요. 기존 앱이 있다면 덮어설치할 수 있습니다. Android에서 요청하면 이 출처의 앱 설치를 허용해 주세요.</p><p>기존 v1.5.0~1.5.2 앱에는 자동 업데이트가 제공됩니다.</p><a href="/">웹에서 열기</a><small>main · <a href="https://github.com/${repository}/commit/${report.source.commit}">${report.source.commit.slice(0, 12)}</a><br>SHA-256 ${report.apkSha256}</small></main></html>`;
}
