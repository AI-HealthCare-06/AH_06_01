import { assertMainSource } from "../../../deployment/source.mjs";
assertMainSource(new URL("../../../", import.meta.url));
import {spawnSync} from "node:child_process";
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {preserveExistingResources,assertSafeModelChanges} from "./plan.mjs";

const root=new URL("../../../",import.meta.url);
const cache=new URL(".cache/model-integration/",root);
const aws="C:/Program Files/Amazon/AWSCLIV2/aws.exe";
function call(args){
  const response=spawnSync(aws,[...args,"--profile","rexrun","--region","ap-southeast-2","--output","json"],{encoding:"utf8",windowsHide:true});
  if(response.status!==0) throw new Error(response.stderr);
  return response.stdout.trim()?JSON.parse(response.stdout):null;
}
const identity=call(["sts","get-caller-identity"]);
if(identity.Account!=="862330372849") throw new Error("Unexpected AWS account");
const artifactStack=call(["cloudformation","describe-stacks","--stack-name","rexrun-test-artifacts"]).Stacks[0];
const bucket=artifactStack.Outputs.find(o=>o.OutputKey==="BucketName").OutputValue;
const zip=new URL("bp-stage.zip",cache), hash=createHash("sha256").update(readFileSync(zip)).digest("hex");
const key=`bp-stage/${hash}.zip`;
const paramsFile=new URL("deploy-parameters.json",cache);
let upload;
if(existsSync(paramsFile)){
  const saved=JSON.parse(readFileSync(paramsFile));
  if(saved.find(p=>p.ParameterKey==="BpStageCodeKey")?.ParameterValue===key){
    const version=saved.find(p=>p.ParameterKey==="BpStageCodeVersion")?.ParameterValue;
    const head=call(["s3api","head-object","--bucket",bucket,"--key",key,"--version-id",version]);
    if(head.ContentLength!==readFileSync(zip).length) throw new Error("Uploaded artifact size mismatch");
    upload={VersionId:version};
  }
}
upload ??= call(["s3api","put-object","--bucket",bucket,"--key",key,"--body",fileURLToPath(zip)]);
const current=call(["cloudformation","describe-stacks","--stack-name","rexrun-test-collector"]).Stacks[0];
const params=current.Parameters.filter(p=>!p.ParameterKey.startsWith("BpStageCode")).map(p=>({ParameterKey:p.ParameterKey,UsePreviousValue:true}));
params.push({ParameterKey:"BpStageCodeKey",ParameterValue:key},{ParameterKey:"BpStageCodeVersion",ParameterValue:upload.VersionId});
writeFileSync(paramsFile,JSON.stringify(params));
const template=new URL("../.cache/cdk.out/rexrun-test-collector.template.json",import.meta.url);
const previousResponse=call(["cloudformation","get-template","--stack-name","rexrun-test-collector","--template-stage","Original"]);
const previous=typeof previousResponse.TemplateBody==="string"?JSON.parse(previousResponse.TemplateBody):previousResponse.TemplateBody;
const reviewed=preserveExistingResources(previous,JSON.parse(readFileSync(template)));
const reviewedFile=new URL("reviewed-template.json",cache);
writeFileSync(reviewedFile,JSON.stringify(reviewed));
const name=`bp-stage-${Date.now()}`;
call(["cloudformation","create-change-set","--stack-name","rexrun-test-collector","--change-set-name",name,
  "--change-set-type","UPDATE","--capabilities","CAPABILITY_IAM","--template-body",`file://${fileURLToPath(reviewedFile)}`,
  "--parameters",`file://${fileURLToPath(paramsFile)}`]);
call(["cloudformation","wait","change-set-create-complete","--stack-name","rexrun-test-collector","--change-set-name",name]);
const changeSet=call(["cloudformation","describe-change-set","--stack-name","rexrun-test-collector","--change-set-name",name]);
const changes=changeSet.Changes.map(c=>c.ResourceChange);
// Existing stateful resources and collector routes must never be replaced.
assertSafeModelChanges(changes);
const report={account:identity.Account,stack:"rexrun-test-collector",changeSet:name,artifactSha256:hash,changes};
writeFileSync(new URL("change-set.json",cache),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
if(process.argv.includes("--deploy")){
  call(["cloudformation","execute-change-set","--stack-name","rexrun-test-collector","--change-set-name",name]);
  console.log("Model change set executing; verify update completion before publishing clients.");
}
