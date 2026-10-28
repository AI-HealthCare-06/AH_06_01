import { execFileSync } from "node:child_process";

export const repository = "AI-HealthCare-06/AH_06_01";
export function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  }).trimEnd();
}

// A detached Actions checkout is allowed only at the exact, current main commit.
export function assertMainSource(
  root,
  { expectedSha, generated = false } = {},
) {
  const remote = git(root, "remote", "get-url", "origin");
  if (
    !new RegExp(
      `^(https://github\\.com/|git@github\\.com:)${repository}(\\.git)?$`,
      "i",
    ).test(remote)
  )
    throw new Error("Deployment requires the REXRUN origin repository");
  const sha = git(root, "rev-parse", "HEAD");
  const main = git(root, "rev-parse", "refs/remotes/origin/main");
  if (sha !== main || (expectedSha && sha !== expectedSha))
    throw new Error("Deployment source must be the current origin/main commit");
  const branch = git(root, "branch", "--show-current");
  if (branch && branch !== "main")
    throw new Error("Deployment requires main or detached main");
  const allowed = new Set(
    generated
      ? [
          "frontend/android/app/capacitor.build.gradle",
          "frontend/android/capacitor.settings.gradle",
        ]
      : [],
  );
  const changes = git(root, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean);
  if (changes.some((line) => !allowed.has(line.slice(3))))
    throw new Error("Deployment source contains uncommitted changes");
  return sha;
}

export function compareVersion(a, b) {
  const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (
    ![a, b].every(
      (v) =>
        pattern.test(v) && v.split(".").every((n) => Number.isSafeInteger(+n)),
    )
  )
    throw new Error("Invalid release version");
  const aa = a.split(".").map(Number),
    bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (aa[i] !== bb[i]) return Math.sign(aa[i] - bb[i]);
  return 0;
}

export function assertPublicFile(name) {
  if (
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    name.split("/").some((p) => !p || p.startsWith(".")) ||
    /\.(map|pem|key|p12|pfx|env|jks|keystore|apk|aab|dex|jar|aar|so|dll|exe|class|br)$/i.test(
      name,
    )
  )
    throw new Error(`Forbidden public file: ${name}`);
}
