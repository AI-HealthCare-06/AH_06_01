import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  git,
  assertMainSource,
  compareVersion,
  assertPublicFile,
} from "./source.mjs";

test("only a clean, current main from the expected origin can publish", () => {
  const root = mkdtempSync(join(tmpdir(), "rexrun-source-test-"));
  try {
    git(root, "init", "-b", "main");
    git(root, "config", "user.name", "Deployment test");
    git(root, "config", "user.email", "test@example.invalid");
    git(
      root,
      "remote",
      "add",
      "origin",
      "https://github.com/AI-HealthCare-06/AH_06_01.git",
    );
    writeFileSync(join(root, "source.txt"), "verified");
    git(root, "add", ".");
    git(root, "commit", "-m", "baseline");
    const sha = git(root, "rev-parse", "HEAD");
    git(root, "update-ref", "refs/remotes/origin/main", sha);
    assert.equal(assertMainSource(root, { expectedSha: sha }), sha);
    assert.throws(
      () => assertMainSource(root, { expectedSha: "0".repeat(40) }),
      /current/,
    );
    git(root, "switch", "-c", "feature/test");
    assert.throws(() => assertMainSource(root), /requires main/);
    git(root, "checkout", "--detach", sha);
    assert.equal(assertMainSource(root), sha);
    writeFileSync(join(root, "source.txt"), "dirty");
    assert.throws(() => assertMainSource(root), /uncommitted/);
    git(root, "add", ".");
    git(root, "commit", "-m", "newer");
    assert.throws(() => assertMainSource(root), /current/);
    git(
      root,
      "remote",
      "set-url",
      "origin",
      "https://github.com/other/repo.git",
    );
    assert.throws(() => assertMainSource(root), /origin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("release versions are numeric and public bundles exclude private/native files", () => {
  assert.equal(compareVersion("1.6.10", "1.6.9"), 1);
  assert.equal(compareVersion("1.6.1", "1.6.1"), 0);
  assert.throws(() => compareVersion("1.06.1", "1.5.10"));
  for (const name of [
    ".env",
    "assets/../secret",
    "private.pem",
    "app.apk",
    "x.map",
    "a\\b.js",
  ])
    assert.throws(() => assertPublicFile(name));
  assertPublicFile("assets/index-ab12.js");
});
