import { assertMainSource } from "../../../deployment/source.mjs";
assertMainSource(new URL("../../../", import.meta.url));
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../../../", import.meta.url);
const cache = new URL(".cache/diet-f6/", root);
const stackName = "rexrun-test-diet-f6";
const aws = "C:/Program Files/Amazon/AWSCLIV2/aws.exe";
function call(args) {
  const r = spawnSync(
    aws,
    [
      ...args,
      "--profile",
      "rexrun",
      "--region",
      "ap-southeast-2",
      "--output",
      "json",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
if (call(["sts", "get-caller-identity"]).Account !== "862330372849")
  throw new Error("Unexpected account");
const artifacts = call([
  "cloudformation",
  "describe-stacks",
  "--stack-name",
  "rexrun-test-artifacts",
]).Stacks[0];
const bucket = artifacts.Outputs.find(
  (o) => o.OutputKey === "BucketName",
).OutputValue;
const build = JSON.parse(readFileSync(new URL("build.json", cache)));
const key = `diet-f6/${build.sha256}.zip`;
const upload = call([
  "s3api",
  "put-object",
  "--bucket",
  bucket,
  "--key",
  key,
  "--body",
  fileURLToPath(new URL("lambda.zip", cache)),
]);
const secretArn = call(["secretsmanager", "describe-secret", "--secret-id", "rexrun/test/diet-openai"]).ARN;
const params = [
  { ParameterKey: "VisionSecretArn", ParameterValue: secretArn },
  { ParameterKey: "CodeBucket", ParameterValue: bucket },
  { ParameterKey: "CodeKey", ParameterValue: key },
  { ParameterKey: "CodeVersion", ParameterValue: upload.VersionId },
];
const paramFile = new URL("deploy-parameters.json", cache);
writeFileSync(paramFile, JSON.stringify(params));
const template = new URL(
  "infra/aws/.cache/diet-cdk.out/rexrun-test-diet-f6.template.json",
  root,
);
call([
  "cloudformation",
  "validate-template",
  "--template-body",
  `file://${fileURLToPath(template)}`,
]);
let type = "CREATE";
try {
  const stack = call([
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
  ]).Stacks[0];
  type = stack.StackStatus === "REVIEW_IN_PROGRESS" ? "CREATE" : "UPDATE";
} catch (error) {
  if (!String(error).includes("does not exist")) throw error;
}
const changeSet = `diet-f6-${Date.now()}`;
call([
  "cloudformation",
  "create-change-set",
  "--stack-name",
  stackName,
  "--change-set-name",
  changeSet,
  "--change-set-type",
  type,
  "--capabilities",
  "CAPABILITY_IAM",
  "--template-body",
  `file://${fileURLToPath(template)}`,
  "--parameters",
  `file://${fileURLToPath(paramFile)}`,
]);
call([
  "cloudformation",
  "wait",
  "change-set-create-complete",
  "--stack-name",
  stackName,
  "--change-set-name",
  changeSet,
]);
const diff = call([
  "cloudformation",
  "describe-change-set",
  "--stack-name",
  stackName,
  "--change-set-name",
  changeSet,
]);
const changes = diff.Changes.map((c) => c.ResourceChange);
if (changes.some((c) => c.Action === "Remove" || c.Replacement === "True"))
  throw new Error("Unexpected destructive change");
const plan = {
  stackName,
  type,
  changeSet,
  changes,
  artifact: build,
  existingStacksModified: false,
};
writeFileSync(
  new URL("deployment-plan.json", cache),
  JSON.stringify(plan, null, 2),
);
console.log(JSON.stringify(plan));
if (process.argv.includes("--deploy")) {
  call([
    "cloudformation",
    "execute-change-set",
    "--stack-name",
    stackName,
    "--change-set-name",
    changeSet,
  ]);
  console.log("Diet stack deployment started.");
}
