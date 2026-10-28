import { spawnSync } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeIdentity } from "./mobile-update-native.mjs";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(frontend, "..");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "native:aab [--init-key] [--web-version 1.3.1]\nUpload key and passwords remain in ignored .cache/android-signing; never upload the private files.",
  );
  process.exit(0);
}
const config = JSON.parse(readFileSync(resolve(frontend, "mobile-updates.config.json"), "utf8"));
const index = args.indexOf("--web-version");
const webVersion = index >= 0 ? args[index + 1] : "1.3.1";
if (!/^\d+\.\d+\.\d+$/.test(webVersion)) throw new Error("Invalid web version");
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  resolve(process.env.LOCALAPPDATA, "Android/Sdk");
const java = process.env.JAVA_HOME;
if (!existsSync(sdk)) throw new Error("Android SDK is required");
const keytool = java ? resolve(java, "bin/keytool.exe") : "keytool";
const jarsigner = java ? resolve(java, "bin/jarsigner.exe") : "jarsigner";
const secrets = resolve(root, ".cache/android-signing");
const metadataPath = resolve(secrets, "signing.private.json");
const keyPath = resolve(secrets, "rexrun-upload.jks");
const env = { ...process.env, ANDROID_HOME: sdk, VITE_REXRUN_WEB_VERSION: webVersion };
function run(command, commandArgs, cwd = frontend) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    windowsHide: true,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(cmd|bat)$/.test(command),
  });
  if (result.error || result.status !== 0)
    throw result.error || new Error(`${command} failed: ${result.status}`);
}
function signingPassword(operation, value) {
  if (process.platform !== "win32")
    throw new Error("This local signing store uses Windows user DPAPI");
  const expression =
    operation === "Protect"
      ? "[Text.Encoding]::UTF8.GetBytes($env:REXRUN_SIGNING_INPUT)"
      : "[Convert]::FromBase64String($env:REXRUN_SIGNING_INPUT)";
  const encoding =
    operation === "Protect"
      ? "[Convert]::ToBase64String($result)"
      : "[Text.Encoding]::UTF8.GetString($result)";
  const result = spawnSync(
    resolve(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Security; $result = [Security.Cryptography.ProtectedData]::${operation}(${expression}, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); ${encoding}`,
    ],
    { env: { ...env, REXRUN_SIGNING_INPUT: value }, windowsHide: true, encoding: "utf8" },
  );
  if (result.error || result.status !== 0 || !result.stdout.trim())
    throw new Error("Windows signing password protection failed");
  return result.stdout.trim();
}
if (existsSync(keyPath) !== existsSync(metadataPath))
  throw new Error("Incomplete signing backup; recover it instead of replacing the key");
if (!existsSync(metadataPath)) {
  if (!args.includes("--init-key"))
    throw new Error("No upload key. Use native:aab -- --init-key once");
  mkdirSync(secrets, { recursive: true });
  const password = randomBytes(32).toString("base64url");
  const values = {
    alias: "rexrun-upload",
    protectedPassword: signingPassword("Protect", password),
  };
  writeFileSync(metadataPath, JSON.stringify(values), { flag: "wx", mode: 0o600 });
  env.REXRUN_RELEASE_STORE_PASSWORD = password;
  env.REXRUN_RELEASE_KEY_PASSWORD = password;
  run(keytool, [
    "-genkeypair",
    "-keystore",
    keyPath,
    "-storetype",
    "PKCS12",
    "-alias",
    values.alias,
    "-keyalg",
    "RSA",
    "-keysize",
    "4096",
    "-validity",
    "10000",
    "-dname",
    "CN=REXRUN Upload Key",
    "-storepass:env",
    "REXRUN_RELEASE_STORE_PASSWORD",
    "-keypass:env",
    "REXRUN_RELEASE_KEY_PASSWORD",
    "-noprompt",
  ]);
}
const signing = JSON.parse(readFileSync(metadataPath, "utf8"));
if (!signing.protectedPassword)
  throw new Error("Signing metadata has no DPAPI password; do not replace the key");
const password = signingPassword("Unprotect", signing.protectedPassword);
Object.assign(env, {
  REXRUN_RELEASE_STORE_FILE: keyPath,
  REXRUN_RELEASE_STORE_PASSWORD: password,
  REXRUN_RELEASE_KEY_ALIAS: signing.alias,
  REXRUN_RELEASE_KEY_PASSWORD: password,
});
const outputDir = resolve(root, ".cache/mobile/play");
mkdirSync(outputDir, { recursive: true });
const certificate = resolve(outputDir, "rexrun-upload-certificate.pem");
run(keytool, [
  "-exportcert",
  "-rfc",
  "-keystore",
  keyPath,
  "-alias",
  signing.alias,
  "-storepass:env",
  "REXRUN_RELEASE_STORE_PASSWORD",
  "-file",
  certificate,
]);
const cert = new X509Certificate(readFileSync(certificate));
if (cert.subject.includes("Android Debug"))
  throw new Error("Debug signing certificate is not allowed for Play");
run("npm.cmd", ["run", "build"]);
run("npx.cmd", ["cap", "sync", "android"]);
run("gradlew.bat", ["bundleRelease"], resolve(frontend, "android"));
const aab = resolve(outputDir, `rexrun-${config.nativeVersion}-internal.aab`);
copyFileSync(resolve(frontend, "android/app/build/outputs/bundle/release/app-release.aab"), aab);
run(jarsigner, ["-verify", aab]);
const gradle = readFileSync(resolve(frontend, "android/app/build.gradle"), "utf8");
const baseline = { ...nativeIdentity(frontend), webVersion, distribution: "google-play" };
writeFileSync(
  resolve(frontend, ".cache/mobile-updates/native-play-baseline.json"),
  JSON.stringify(baseline, null, 2),
);
const report = {
  package: "com.rexrun.demo",
  nativeVersion: config.nativeVersion,
  versionCode: Number(gradle.match(/versionCode\s+(\d+)/)?.[1]),
  webVersion,
  sha256: createHash("sha256").update(readFileSync(aab)).digest("hex"),
  bytes: readFileSync(aab).length,
  uploadCertificateSha1: cert.fingerprint,
  uploadCertificateSha256: cert.fingerprint256,
  debuggable: false,
  supabaseOtaPreserved: true,
  otaNativeChannel: config.nativeVersion,
};
writeFileSync(resolve(outputDir, "build-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Play upload bundle: ${aab}`);
