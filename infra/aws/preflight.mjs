import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));

export function validateConfig(value) {
  const allowed = ["profile", "region", "expectedAccountId", "resourcePrefix"];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AWS connection config must be an object.");
  }
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(
      "Config accepts only profile, region, expectedAccountId and resourcePrefix.",
    );
  }
  if (allowed.some((key) => typeof value[key] !== "string")) {
    throw new Error("All connection config values must be strings.");
  }
  if (
    !/^[a-zA-Z0-9_-]+$/.test(value.profile ?? "") ||
    value.profile === "default"
  ) {
    throw new Error(
      "Use a dedicated named AWS profile; default is not allowed.",
    );
  }
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(value.region ?? "")) {
    throw new Error("Specify an AWS region explicitly.");
  }
  if (!/^\d{12}$/.test(value.expectedAccountId ?? "")) {
    throw new Error(
      "Set expectedAccountId to the 12-digit NEW account ID verified after login.",
    );
  }
  if (!/^rexrun-[a-z0-9-]+$/.test(value.resourcePrefix ?? "")) {
    throw new Error(
      "resourcePrefix must start with rexrun- and contain only lowercase letters, digits or hyphens.",
    );
  }
  return value;
}

export function awsEnvironment(source = process.env) {
  // Do not let a previous shell's keys, profile, config paths or endpoint override this project.
  const excluded = new Set([
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_ROLE_ARN",
    "AWS_ROLE_SESSION_NAME",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(source).filter(
        ([key]) =>
          !excluded.has(key.toUpperCase()) &&
          !key.toUpperCase().startsWith("AWS_ENDPOINT_URL"),
      ),
    ),
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_CLI_AUTO_PROMPT: "off",
    AWS_PAGER: "",
    AWS_MAX_ATTEMPTS: "1",
  };
}

async function awsJson(args) {
  const { stdout } = await execute("aws", args, {
    env: awsEnvironment(),
    timeout: 30000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function runPreflight(input, call = awsJson) {
  const config = validateConfig(input);
  const optionsFor = (region) => [
    "--profile",
    config.profile,
    "--region",
    region,
    "--output",
    "json",
    "--no-cli-pager",
  ];
  const options = optionsFor(config.region);
  const identity = await call(["sts", "get-caller-identity", ...options]);
  if (
    identity.Account !== config.expectedAccountId ||
    typeof identity.Arn !== "string" ||
    identity.Arn.split(":")[4] !== config.expectedAccountId
  ) {
    throw new Error(
      "AWS account mismatch. Stopped before resource or billing checks.",
    );
  }

  const prefix = config.resourcePrefix;
  const definitions = [
    ["accountPlan", ["freetier", "get-account-plan-state"]],
    [
      "webBuckets",
      [
        "s3api",
        "list-buckets",
        "--query",
        `Buckets[?starts_with(Name, '${prefix}')].Name`,
      ],
    ],
    [
      "webDistributions",
      [
        "cloudfront",
        "list-distributions",
        "--query",
        `DistributionList.Items[?starts_with(Comment, 'REXRUN')].{id:Id,domain:DomainName,status:Status}`,
      ],
    ],
    [
      "apiRepositories",
      [
        "ecr",
        "describe-repositories",
        "--query",
        `repositories[?starts_with(repositoryName, '${prefix}')].{name:repositoryName}`,
      ],
    ],
    [
      "apiClusters",
      [
        "ecs",
        "list-clusters",
        "--query",
        `clusterArns[?contains(@, ':cluster/${prefix}')]`,
      ],
    ],
    [
      "stacks",
      [
        "cloudformation",
        "describe-stacks",
        "--query",
        `Stacks[?starts_with(StackName, '${prefix}')].{name:StackName,status:StackStatus}`,
      ],
    ],
    [
      "collectorFunctions",
      [
        "lambda",
        "list-functions",
        "--query",
        `Functions[?starts_with(FunctionName, '${prefix}')].FunctionName`,
      ],
    ],
    [
      "collectorApis",
      [
        "apigatewayv2",
        "get-apis",
        "--query",
        `Items[?starts_with(Name, '${prefix}')].Name`,
      ],
    ],
    [
      "collectorTables",
      [
        "dynamodb",
        "list-tables",
        "--query",
        `TableNames[?starts_with(@, '${prefix}')]`,
      ],
    ],
  ];
  const checks = Object.fromEntries(
    await Promise.all(
      definitions.map(async ([name, args]) => {
        try {
          // Free Tier is a global account service. Do not infer eligibility from missing usage.
          const scoped =
            name === "accountPlan" ? optionsFor("us-east-1") : options;
          return [
            name,
            { status: "ok", value: await call([...args, ...scoped]) },
          ];
        } catch (error) {
          const detail = String(error.stderr ?? error.message ?? "");
          const code =
            detail.match(/\(([^()\s]+)\) when calling/)?.[1] ??
            "CheckUnavailable";
          return [name, { status: "unknown", code }];
        }
      }),
    ),
  );
  return {
    checkedAt: new Date().toISOString(),
    profile: config.profile,
    region: config.region,
    accountId: identity.Account,
    principalArn: identity.Arn,
    accountVerified: true,
    rootSession: identity.Arn.endsWith(":root"),
    deploymentApproved: false,
    checks,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1)
    throw new Error("Usage: node infra/aws/preflight.mjs [config.json]");
  const configPath = resolve(
    args[0] ?? resolve(directory, "connection.local.json"),
  );
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const report = await runPreflight(config);
  const reportPath = resolve(directory, ".cache/preflight.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Read-only checks complete. Local report: ${reportPath}`);
  if (Object.values(report.checks).some((check) => check.status !== "ok"))
    process.exitCode = 2;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    // Never dump subprocess output: auth caches or credentials do not belong in a report.
    console.error(
      error.code === "ENOENT"
        ? "Missing connection.local.json or AWS CLI. See infra/aws/README.md."
        : error.message?.startsWith("Command failed")
          ? "AWS authentication failed. Sign in to the dedicated profile and retry."
          : error.message,
    );
    process.exitCode = 1;
  });
}
