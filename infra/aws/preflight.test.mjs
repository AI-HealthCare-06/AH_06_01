import assert from "node:assert/strict";
import test from "node:test";
import { awsEnvironment, runPreflight, validateConfig } from "./preflight.mjs";

const config = {
  profile: "rexrun",
  region: "ap-northeast-2",
  expectedAccountId: "123456789012",
  resourcePrefix: "rexrun-test",
};
const identity = {
  Account: config.expectedAccountId,
  Arn: "arn:aws:iam::123456789012:user/test",
};

test("unbound example or default profile cannot query AWS", async () => {
  let calls = 0;
  for (const invalid of [
    { ...config, expectedAccountId: "" },
    { ...config, profile: "default" },
  ]) {
    await assert.rejects(
      runPreflight(invalid, async () => {
        calls++;
      }),
    );
  }
  assert.equal(calls, 0);
  assert.throws(() => validateConfig({ ...config, accessKey: "not-accepted" }));
});

test("another account cannot reach resource or billing inventory", async () => {
  const calls = [];
  await assert.rejects(
    runPreflight(config, async (args) => {
      calls.push(args);
      return {
        Account: "999999999999",
        Arn: "arn:aws:iam::999999999999:user/other",
      };
    }),
    /account mismatch/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["sts", "get-caller-identity"]);
});

test("all checks explicitly select the project profile and remain read-only", async () => {
  const calls = [];
  const report = await runPreflight(config, async (args) => {
    calls.push(args);
    return args[0] === "sts" ? identity : [];
  });
  assert.equal(report.accountVerified, true);
  assert.equal(report.deploymentApproved, false);
  assert.equal(calls.length, 10);
  for (const args of calls) {
    assert.equal(args[args.indexOf("--profile") + 1], "rexrun");
    assert.match(args[1], /^(get-|list-|describe-)/);
  }
});

test("denied inventory is unknown rather than an empty account or broad permission grant", async () => {
  const report = await runPreflight(config, async (args) => {
    if (args[0] === "sts") return identity;
    throw Object.assign(new Error("unavailable"), {
      stderr:
        "An error occurred (AccessDenied) when calling the ListBuckets operation",
    });
  });
  assert.equal(report.accountVerified, true);
  assert.deepEqual(report.checks.webBuckets, {
    status: "unknown",
    code: "AccessDenied",
  });
  assert.equal(report.deploymentApproved, false);
});

test("old shell credentials and alternate AWS endpoints cannot override the named login", () => {
  const env = awsEnvironment({
    PATH: "keep",
    AWS_PROFILE: "previous",
    AWS_ACCESS_KEY_ID: "discard",
    AWS_SECRET_ACCESS_KEY: "discard",
    AWS_ENDPOINT_URL_STS: "https://invalid.example",
    AWS_CONFIG_FILE: "previous.config",
  });
  assert.equal(env.PATH, "keep");
  assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.AWS_PROFILE, undefined);
  assert.equal(env.AWS_CONFIG_FILE, undefined);
  assert.equal(env.AWS_ENDPOINT_URL_STS, undefined);
  assert.equal(env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS, "true");
});
