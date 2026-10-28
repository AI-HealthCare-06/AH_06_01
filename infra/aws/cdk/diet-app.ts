import * as cdk from "aws-cdk-lib";
import { DietStack } from "./diet-stack.js";
const app = new cdk.App();
new DietStack(app, "rexrun-test-diet-f6", {
  env: { account: "862330372849", region: "ap-southeast-2" },
  synthesizer: new cdk.BootstraplessSynthesizer(),
});
cdk.Tags.of(app).add("Project", "REXRUN");
cdk.Tags.of(app).add("Environment", "test");
