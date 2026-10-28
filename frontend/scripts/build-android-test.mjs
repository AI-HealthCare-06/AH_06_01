import { spawnSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadReleaseSigning } from "./android-signing.mjs";
import { nativeIdentity } from "./mobile-update-native.mjs";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(frontend, "..");
const webVersion =
  process.env.VITE_REXRUN_WEB_VERSION ||
  JSON.parse(readFileSync(resolve(frontend, "mobile-updates.config.json"), "utf8")).nativeVersion;
if (!/^\d+\.\d+\.\d+$/.test(webVersion)) throw new Error("Invalid web version");
const sdk = process.env.ANDROID_HOME || resolve(process.env.LOCALAPPDATA, "Android/Sdk");
const env = {
  ...process.env,
  ...loadReleaseSigning(root),
  ANDROID_HOME: sdk,
  VITE_REXRUN_WEB_VERSION: webVersion,
  REXRUN_LEGACY_PASSWORD: "android",
};
const windows = process.platform === "win32";
const apksigner = resolve(sdk, `build-tools/36.0.0/apksigner${windows ? ".bat" : ""}`);
const keytool = resolve(process.env.JAVA_HOME, `bin/keytool${windows ? ".exe" : ""}`);
const folder = resolve(root, ".cache/android-signing");
const output = resolve(root, ".cache/mobile/firebase");
mkdirSync(output, { recursive: true });
const legacy =
  process.env.REXRUN_LEGACY_STORE_FILE || resolve(folder, "rexrun-legacy-debug.keystore");
if (!existsSync(legacy))
  copyFileSync(resolve(process.env.USERPROFILE, ".android/debug.keystore"), legacy);
function run(command, args, cwd = frontend) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
    shell: /\.(cmd|bat)$/.test(command),
  });
  if (result.error || result.status !== 0)
    throw result.error || new Error(`${command} failed: ${result.status}`);
}
const oldCert = resolve(output, "legacy-certificate.pem");
run(keytool, [
  "-exportcert",
  "-rfc",
  "-keystore",
  legacy,
  "-alias",
  "androiddebugkey",
  "-storepass:env",
  "REXRUN_LEGACY_PASSWORD",
  "-file",
  oldCert,
]);
const legacyFingerprint = new X509Certificate(readFileSync(oldCert)).fingerprint256
  .replaceAll(":", "")
  .toLowerCase();
if (legacyFingerprint !== "356e716af83d623755456d2a7764d18a0ef072decb5a7d8e8c558832735dff45")
  throw new Error("Legacy signing key does not match the installed REXRUN APK; do not replace it");
const lineage =
  process.env.REXRUN_SIGNING_LINEAGE_FILE || resolve(folder, "rexrun-debug-to-release.lineage");
const oldSigner = [
  "--ks",
  legacy,
  "--ks-key-alias",
  "androiddebugkey",
  "--ks-pass",
  "env:REXRUN_LEGACY_PASSWORD",
  "--key-pass",
  "env:REXRUN_LEGACY_PASSWORD",
];
const newSigner = [
  "--ks",
  env.REXRUN_RELEASE_STORE_FILE,
  "--ks-key-alias",
  env.REXRUN_RELEASE_KEY_ALIAS,
  "--ks-pass",
  "env:REXRUN_RELEASE_STORE_PASSWORD",
  "--key-pass",
  "env:REXRUN_RELEASE_KEY_PASSWORD",
];
if (!existsSync(lineage))
  run(apksigner, [
    "rotate",
    "--out",
    lineage,
    "--old-signer",
    ...oldSigner,
    "--set-installed-data",
    "true",
    "--set-rollback",
    "false",
    "--new-signer",
    ...newSigner,
  ]);
run(windows ? "npm.cmd" : "npm", ["run", "build"]);
run(windows ? "npx.cmd" : "npx", ["cap", "sync", "android"]);
run(
  windows ? "gradlew.bat" : "bash",
  windows ? ["assembleRelease"] : ["./gradlew", "assembleRelease"],
  resolve(frontend, "android"),
);
const gradle = readFileSync(resolve(frontend, "android/app/build.gradle"), "utf8");
const versionCode = Number(gradle.match(/versionCode\s+(\d+)/)?.[1]);
const identity = nativeIdentity(frontend);
const config = JSON.parse(readFileSync(resolve(frontend, "mobile-updates.config.json"), "utf8"));
if (identity.nativeVersion !== config.nativeVersion) throw new Error("Native OTA channel mismatch");
const apk = resolve(output, `rexrun-${identity.nativeVersion}-${versionCode}-upgrade.apk`);
run(apksigner, [
  "sign",
  "--ks",
  legacy,
  ...oldSigner.slice(2),
  "--next-signer",
  ...newSigner,
  "--lineage",
  lineage,
  "--rotation-min-sdk-version",
  "28",
  "--debuggable-apk-permitted",
  "false",
  "--out",
  apk,
  resolve(frontend, "android/app/build/outputs/apk/release/app-release.apk"),
]);
run(apksigner, ["verify", "--verbose", "--print-certs", apk]);
run(resolve(sdk, `build-tools/36.0.0/zipalign${windows ? ".exe" : ""}`), [
  "-c",
  "-P",
  "16",
  "4",
  apk,
]);
mkdirSync(resolve(frontend, ".cache/mobile-updates"), { recursive: true });
writeFileSync(
  resolve(frontend, ".cache/mobile-updates/native-test-baseline.json"),
  JSON.stringify({ ...identity, webVersion, distribution: "firebase-signing-lineage" }, null, 2),
);
const report = {
  package: "com.rexrun.demo",
  nativeVersion: identity.nativeVersion,
  versionCode,
  webVersion,
  apk,
  bytes: readFileSync(apk).length,
  sha256: createHash("sha256").update(readFileSync(apk)).digest("hex"),
  legacyFingerprint,
  rotationMinSdk: 28,
  installedDataCapability: true,
  rollbackToLegacySigner: false,
  supabaseOtaPreserved: true,
  lineageSha256: createHash("sha256").update(readFileSync(lineage)).digest("hex"),
};
writeFileSync(resolve(output, "build-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
