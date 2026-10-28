import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeIdentity } from "../frontend/scripts/mobile-update-native.mjs";

test("native compatibility is stable across Windows/Linux text and ignores generated Cordova config", () => {
  const original = resolve(dirname(fileURLToPath(import.meta.url)), "../frontend");
  const root = mkdtempSync(join(tmpdir(), "rexrun-native-test-"));
  try {
    const files = ["capacitor.config.ts", "mobile-updates.config.json", "package.json", "android/app/build.gradle",
      "android/build.gradle", "android/settings.gradle", "android/gradle.properties", "android/variables.gradle",
      "android/gradle/wrapper/gradle-wrapper.properties", "android/app/src/main/AndroidManifest.xml",
      "android/app/google-services.json", "android/app/src/main/java", "android/app/src/main/res"];
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      cpSync(join(original, file), join(root, file), { recursive: true });
    }
    const baseline = nativeIdentity(root, { canonical: true });
    function crlf(folder) {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) crlf(path);
        else if (/\.(ts|json|gradle|properties|xml|java|txt|pro)$/.test(path))
          writeFileSync(path, readFileSync(path, "utf8").replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"));
      }
    }
    crlf(root);
    mkdirSync(join(root, "android/app/src/main/res/xml"), { recursive: true });
    writeFileSync(join(root, "android/app/src/main/res/xml/config.xml"), "<generated/>\r\n");
    assert.deepEqual(nativeIdentity(root, { canonical: true }), baseline);
    const java = join(root, "android/app/src/main/java/com/rexrun/demo/MainActivity.java");
    writeFileSync(java, readFileSync(java, "utf8") + "\n// Native behavior changed\n");
    assert.notEqual(nativeIdentity(root, { canonical: true }).fingerprint, baseline.fingerprint);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
