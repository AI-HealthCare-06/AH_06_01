import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { nativeIdentity } from "./mobile-update-native.mjs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  (process.env.LOCALAPPDATA && resolve(process.env.LOCALAPPDATA, "Android", "Sdk"));
if (!sdk || !existsSync(sdk))
  throw new Error("Android SDK를 설치하고 ANDROID_HOME을 설정해 주세요.");
const env = { ...process.env, ANDROID_HOME: sdk };
function run(command, args, cwd = frontend) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || result.status !== 0)
    throw result.error || new Error(`${command} failed: ${result.status}`);
}
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);
run(process.platform === "win32" ? "npx.cmd" : "npx", ["cap", "sync", "android"]);
run(
  process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  ["assembleDebug"],
  resolve(frontend, "android"),
);
const output = resolve(frontend, "..", ".cache", "mobile", "rexrun-galaxy-debug.apk");
mkdirSync(dirname(output), { recursive: true });
copyFileSync(
  resolve(frontend, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk"),
  output,
);
const baseline = resolve(frontend, ".cache/mobile-updates/native-baseline.json");
mkdirSync(dirname(baseline), { recursive: true });
writeFileSync(
  baseline,
  JSON.stringify(
    {
      ...nativeIdentity(frontend),
      webVersion:
        process.env.VITE_REXRUN_WEB_VERSION ||
        JSON.parse(readFileSync(resolve(frontend, "mobile-updates.config.json"), "utf8"))
          .nativeVersion,
    },
    null,
    2,
  ),
);
console.log(`Galaxy test APK: ${output}`);
