import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";

export function nativeIdentity(frontend, { canonical = false } = {}) {
  const files = [
    "capacitor.config.ts",
    "mobile-updates.config.json",
    "android/app/build.gradle",
    "android/build.gradle",
    "android/settings.gradle",
    "android/gradle.properties",
    "android/gradle/wrapper/gradle-wrapper.properties",
    "android/variables.gradle",
    "android/app/src/main/AndroidManifest.xml",
  ];
  if (existsSync(resolve(frontend, "android/app/google-services.json")))
    files.push("android/app/google-services.json");
  function walk(folder) {
    for (const entry of readdirSync(resolve(frontend, folder), { withFileTypes: true })) {
      const name = `${folder}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else if (!canonical || name !== "android/app/src/main/res/xml/config.xml") files.push(name);
    }
  }
  walk("android/app/src/main/java");
  walk("android/app/src/main/res");
  const hash = createHash("sha256");
  for (const path of files.sort())
    hash
      .update(canonical ? path.replaceAll("\\", "/") : relative(frontend, resolve(frontend, path)))
      .update(
        canonical && /\.(ts|json|gradle|properties|xml|java|txt|pro)$/.test(path)
          ? readFileSync(resolve(frontend, path), "utf8").replaceAll("\r\n", "\n")
          : readFileSync(resolve(frontend, path)),
      );
  const pkg = JSON.parse(readFileSync(resolve(frontend, "package.json"), "utf8"));
  hash.update(
    JSON.stringify(
      Object.entries(pkg.dependencies)
        .filter(
          ([name]) =>
            name.startsWith("@capacitor/") ||
            name.startsWith("@capgo/") ||
            name.startsWith("@capacitor-firebase/"),
        )
        .sort(),
    ),
  );
  const gradle = readFileSync(resolve(frontend, "android/app/build.gradle"), "utf8");
  return {
    nativeVersion: gradle.match(/versionName\s+"([^"]+)"/)?.[1],
    fingerprint: hash.digest("hex"),
  };
}
