import * as cdk from "aws-cdk-lib";
import {
  aws_s3 as s3,
  aws_cloudfront as cf,
  aws_cloudfront_origins as origins,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_iam as iam,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_integrations as integrations,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
export class WebStack extends cdk.Stack {
  readonly webUrl: string;
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const bucket = new s3.Bucket(this, "WebAssets", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: cdk.Duration.days(30),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });
    const rewrite = new cf.Function(this, "SpaPaths", {
      runtime: cf.FunctionRuntime.JS_2_0,
      code: cf.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; if (r.uri.indexOf('.') === -1) r.uri = '/index.html'; return r; }",
      ),
    });
    const distribution = new cf.Distribution(this, "Web", {
      comment: "REXRUN test web demo - PAYG estimate, no plan enrollment",
      defaultRootObject: "index.html",
      priceClass: cf.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: new cf.CachePolicy(this, "RespectOriginCache", {
          minTtl: cdk.Duration.seconds(0),
          defaultTtl: cdk.Duration.seconds(0),
          maxTtl: cdk.Duration.days(365),
          enableAcceptEncodingGzip: true,
          enableAcceptEncodingBrotli: true,
        }),
        responseHeadersPolicy: cf.ResponseHeadersPolicy.SECURITY_HEADERS,
        functionAssociations: [
          { function: rewrite, eventType: cf.FunctionEventType.VIEWER_REQUEST },
        ],
      },
    });
    new cdk.CfnOutput(this, "BucketName", {
      value: bucket.bucketName,
      description: "Upload only reviewed frontend/dist files after approval",
    });
    this.webUrl = `https://${distribution.distributionDomainName}`;
    new cdk.CfnOutput(this, "WebUrl", {
      value: this.webUrl,
      description: "Web demo HTTPS URL after deployment",
    });
  }
}
export class ArtifactsStack extends cdk.Stack {
  readonly bucket: s3.Bucket;
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, { ...props, terminationProtection: true });
    this.bucket = new s3.Bucket(this, "Artifacts", {
      versioned:true,
      encryption:s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL:true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new cdk.CfnOutput(this, "BucketName", {
      value: this.bucket.bucketName,
    });
  }
}
interface ApiProps extends cdk.StackProps {
  readonly bucket: s3.IBucket;
  readonly webUrl: string;
}
export class CollectorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiProps) {
    super(scope, id, props);
    const codeKey = new cdk.CfnParameter(this,'CollectorCodeKey',{type:'String',allowedPattern:'collector/[a-f0-9]+.zip'});
    const codeVersion = new cdk.CfnParameter(this,'CollectorCodeVersion',{type:'String'});
    const modelCodeKey = new cdk.CfnParameter(this,'BpStageCodeKey',{type:'String',allowedPattern:'bp-stage/[a-f0-9]+.zip'});
    const modelCodeVersion = new cdk.CfnParameter(this,'BpStageCodeVersion',{type:'String'});
    const publicKey = new cdk.CfnParameter(this,'SupabasePublishableKey',{type:'String',description:'Public client key only; never a service_role key'});
    const logGroup = new logs.LogGroup(this, "CollectorLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const fn = new lambda.Function(this, "Collector", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromBucket(props.bucket,codeKey.valueAsString,codeVersion.valueAsString),
      role: new iam.Role(this,'CollectorRole',{assumedBy:new iam.ServicePrincipal('lambda.amazonaws.com'),description:'REXRUN collector: scoped CloudWatch logs only. Database access uses the caller Supabase JWT and RLS.'}),
      memorySize: 512,
      timeout: cdk.Duration.seconds(20),
      // This new account has a total quota of 10. Lambda rejects reservations
      // while fewer than 100 unreserved executions remain; HTTP API is throttled.
      logGroup,
      environment: { SUPABASE_URL:'https://bjyanmywcclymklgcrhi.supabase.co', SUPABASE_PUBLISHABLE_KEY:publicKey.valueAsString },
    });
    logGroup.grantWrite(fn);
    const api = new apigw.HttpApi(this, "Api", {
      apiName: `${id}-http`,
      createDefaultStage: false,
      corsPreflight:{allowOrigins:[props.webUrl,'https://localhost','http://localhost','http://localhost:5173','http://127.0.0.1:5173'],allowMethods:[apigw.CorsHttpMethod.GET,apigw.CorsHttpMethod.POST,apigw.CorsHttpMethod.OPTIONS],allowHeaders:['authorization','content-type'],maxAge:cdk.Duration.hours(1)},
    });
    const integration = new integrations.HttpLambdaIntegration(
      "CollectorIntegration",
      fn,
    );
    const modelLogs = new logs.LogGroup(this,"BpStageLogs",{
      retention:logs.RetentionDays.ONE_WEEK,removalPolicy:cdk.RemovalPolicy.RETAIN,
    });
    const model = new lambda.Function(this,"BpStage",{
      runtime:lambda.Runtime.PYTHON_3_12,architecture:lambda.Architecture.X86_64,
      handler:"handler.handler",code:lambda.Code.fromBucket(props.bucket,modelCodeKey.valueAsString,modelCodeVersion.valueAsString),
      role:new iam.Role(this,"BpStageRole",{assumedBy:new iam.ServicePrincipal("lambda.amazonaws.com"),
        description:"REXRUN M1-S: own CloudWatch logs only; caller JWT and Supabase RLS for reads; no service-role key"}),
      memorySize:1024,timeout:cdk.Duration.seconds(30),logGroup:modelLogs,
      environment:{SUPABASE_URL:'https://bjyanmywcclymklgcrhi.supabase.co',SUPABASE_PUBLISHABLE_KEY:publicKey.valueAsString,
        OPENBLAS_NUM_THREADS:"1",OMP_NUM_THREADS:"1",MPLCONFIGDIR:"/tmp/matplotlib"},
    });
    modelLogs.grantWrite(model);
    const modelIntegration = new integrations.HttpLambdaIntegration("BpStageIntegration",model);
    for (const path of ["/predictions/bp-stage","/v1/predictions/bp-stage"]) {
      api.addRoutes({path,methods:[apigw.HttpMethod.POST],integration:modelIntegration});
    }
    api.addRoutes({path:"/predictions/bp-stage/health",methods:[apigw.HttpMethod.GET],integration:modelIntegration});
    api.addRoutes({
      path: "/health",
      methods: [apigw.HttpMethod.GET],
      integration,
    });
    api.addRoutes({path:'/v1/me',methods:[apigw.HttpMethod.GET],integration});
    for(const path of ['/v1/sync','/v1/devices/push','/v1/notifications/dispatch']) api.addRoutes({path,methods:[apigw.HttpMethod.POST],integration});
    new apigw.HttpStage(this, "TestStage", {
      httpApi: api,
      stageName: "$default",
      autoDeploy: true,
      throttle: { rateLimit: 2, burstLimit: 4 },
    });
    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.apiEndpoint,
      description:
        "Health public; all data routes validate a Supabase user bearer token; RLS enforced",
    });
    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
      description: "Execution role must allow writing only this group",
    });
  }
}
