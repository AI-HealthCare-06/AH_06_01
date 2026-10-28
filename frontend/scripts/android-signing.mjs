import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadReleaseSigning(root) {
  const names = [
    "REXRUN_RELEASE_STORE_FILE",
    "REXRUN_RELEASE_STORE_PASSWORD",
    "REXRUN_RELEASE_KEY_ALIAS",
    "REXRUN_RELEASE_KEY_PASSWORD",
  ];
  if (names.some((name) => process.env[name])) {
    if (!names.every((name) => process.env[name]))
      throw new Error("Incomplete release signing environment");
    readFileSync(process.env.REXRUN_RELEASE_STORE_FILE);
    return Object.fromEntries(names.map((name) => [name, process.env[name]]));
  }
  if (process.platform !== "win32") throw new Error("Local signing requires Windows user DPAPI");
  const folder = resolve(root, ".cache/android-signing");
  const signing = JSON.parse(readFileSync(resolve(folder, "signing.private.json"), "utf8"));
  const result = spawnSync(
    resolve(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.Security; [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($env:REXRUN_SIGNING_INPUT), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))",
    ],
    {
      env: { ...process.env, REXRUN_SIGNING_INPUT: signing.protectedPassword },
      windowsHide: true,
      encoding: "utf8",
    },
  );
  if (result.status !== 0 || !result.stdout.trim())
    throw new Error("Signing key password unavailable");
  return {
    REXRUN_RELEASE_STORE_FILE: resolve(folder, "rexrun-upload.jks"),
    REXRUN_RELEASE_STORE_PASSWORD: result.stdout.trim(),
    REXRUN_RELEASE_KEY_ALIAS: signing.alias,
    REXRUN_RELEASE_KEY_PASSWORD: result.stdout.trim(),
  };
}
