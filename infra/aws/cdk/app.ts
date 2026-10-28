import * as cdk from "aws-cdk-lib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebStack, ArtifactsStack, CollectorStack } from "./stacks.js";

const config = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../connection.local.json", import.meta.url)),
    "utf8",
  ),
) as { expectedAccountId: string; region: string; profile: string };
if (
  !/^\d{12}$/.test(config.expectedAccountId) ||
  config.profile !== "rexrun" ||
  config.region !== "ap-southeast-2"
)
  throw new Error(
    "Use the verified rexrun account and allowed Sydney deployment region",
  );
const app = new cdk.App();
const props = {
  env: { account: config.expectedAccountId, region: config.region },
  synthesizer: new cdk.BootstraplessSynthesizer(),
};
const web = new WebStack(app, "rexrun-test-web", props);
const artifacts = new ArtifactsStack(app, "rexrun-test-artifacts", {...props,synthesizer:new cdk.BootstraplessSynthesizer()});
new CollectorStack(app, "rexrun-test-collector", {
  ...props,
  synthesizer:new cdk.BootstraplessSynthesizer(),
  bucket: artifacts.bucket,
  webUrl: web.webUrl,
});
cdk.Tags.of(app).add("Project", "REXRUN");
cdk.Tags.of(app).add("Environment", "test");
cdk.Tags.of(app).add("Purpose", "authenticated-mobile-data-collection");
