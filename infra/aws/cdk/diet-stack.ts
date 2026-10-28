import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";

export class DietStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    const bucketName = new cdk.CfnParameter(this, "CodeBucket");
    const codeKey = new cdk.CfnParameter(this, "CodeKey");
    const codeVersion = new cdk.CfnParameter(this, "CodeVersion");
    const bucket = s3.Bucket.fromBucketName(
      this,
      "Artifacts",
      bucketName.valueAsString,
    );
    const quota = new dynamodb.Table(this, "Quota", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expires_at",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const secret = secrets.Secret.fromSecretCompleteArn(
      this,
      "VisionSecret",
      new cdk.CfnParameter(this, "VisionSecretArn", { noEcho: true }).valueAsString,
    );
    const logGroup = new logs.LogGroup(this, "Logs", {
      retention: logs.RetentionDays.ONE_WEEK,
    });
    const fn = new lambda.Function(this, "Api", {
      functionName: "rexrun-test-diet-f6",
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.X86_64,
      handler: "f6_diet.lambda_handler.handler",
      code: lambda.Code.fromBucket(
        bucket,
        codeKey.valueAsString,
        codeVersion.valueAsString,
      ),
      timeout: cdk.Duration.seconds(90),
      memorySize: 768,
      logGroup,
      environment: {
        F6_APP_ENV: "production",
        F6_ALLOWED_ORIGINS:
          "https://d4vy5vn0lhbgi.cloudfront.net,https://localhost,http://localhost,capacitor://localhost",
        F6_SUPABASE_URL: "https://bjyanmywcclymklgcrhi.supabase.co",
        F6_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_Q-EY4EVwICQXGeZz_gkTBQ_UDfGtOJD",
        F6_QUOTA_TABLE: quota.tableName,
        VISION_API_KEY: secret
          .secretValueFromJson("VISION_API_KEY")
          .unsafeUnwrap(),
        VISION_MODEL: "gpt-4o-mini",
        VISION_BASE_URL: "",
      },
    });
    quota.grant(fn, "dynamodb:UpdateItem");
    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });
    new cdk.CfnOutput(this, "ApiUrl", { value: `${url.url}api/diet` });
    new cdk.CfnOutput(this, "FunctionName", { value: fn.functionName });
    new cdk.CfnOutput(this, "QuotaTable", { value: quota.tableName });
  }
}
