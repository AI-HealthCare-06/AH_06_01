const base = process.env.GITHUB_BASE_REF;
const head = process.env.GITHUB_HEAD_REF;
const taskBranch = (prefix) => new RegExp(`^${prefix}/[a-z0-9][a-z0-9.-]*$`).test(head ?? "");
const allowed =
  (base === "main" && (taskBranch("release") || taskBranch("hotfix"))) ||
  (base === "develop" && (head === "main" || taskBranch("feature") || taskBranch("release") || taskBranch("hotfix")));

if (!allowed) {
  console.error(`Invalid Git Flow PR: ${head ?? "(missing)"} -> ${base ?? "(missing)"}. See docs/GIT_FLOW.md.`);
  process.exitCode = 1;
} else {
  console.log(`Git Flow OK: ${head} -> ${base}`);
}
