import { assertMainSource } from "../../../deployment/source.mjs";
assertMainSource(new URL("../../../", import.meta.url));
import {spawnSync} from "node:child_process";
import {readdirSync,statSync,readFileSync,writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
const root=new URL("../../../",import.meta.url), dist=fileURLToPath(new URL("frontend/dist/",root));
const aws="C:/Program Files/Amazon/AWSCLIV2/aws.exe";
function call(args){
  const r=spawnSync(aws,[...args,"--profile","rexrun","--region","ap-southeast-2","--output","json"],{encoding:"utf8",windowsHide:true});
  if(r.status!==0) throw new Error(r.stderr);
  return r.stdout.trim()?JSON.parse(r.stdout):null;
}
if(call(["sts","get-caller-identity"]).Account!=="862330372849") throw new Error("Unexpected AWS account");
const verification=JSON.parse(readFileSync(new URL(".cache/model-integration/live-verification.json",root)));
if(verification.modelVersion!=="M1-20261020_150607-nested__base") throw new Error("Live model verification required before client publication");
function walk(path){return readdirSync(path).flatMap(name=>{const p=join(path,name);return statSync(p).isDirectory()?walk(p):[p];});}
const files=walk(dist);
if(files.some(p=>/(?:^|[\\/])\.env|\.(?:pem|key|jks|keystore|pkl|joblib|apk|aab)$/i.test(p))) throw new Error("Private or native build file in web output");
const outputs=call(["cloudformation","describe-stacks","--stack-name","rexrun-test-web"]).Stacks[0].Outputs;
const bucket=outputs.find(o=>o.OutputKey==="BucketName").OutputValue;
const webUrl=outputs.find(o=>o.OutputKey==="WebUrl").OutputValue;
const distribution=call(["cloudfront","list-distributions"]).DistributionList.Items.find(d=>`https://${d.DomainName}`===webUrl);
if(!distribution) throw new Error("Existing web distribution not found");
const sync=spawnSync(aws,["s3","sync",dist,`s3://${bucket}/`,"--size-only","--exclude","index.html","--exclude","privacypolicy.html","--exclude","*.map","--cache-control","public,max-age=31536000,immutable","--no-progress","--profile","rexrun","--region","ap-southeast-2"],{encoding:"utf8",windowsHide:true});
if(sync.status!==0) throw new Error(sync.stderr);
for(const name of ["privacypolicy.html","index.html"]){
  const r=spawnSync(aws,["s3","cp",join(dist,name),`s3://${bucket}/${name}`,"--content-type","text/html; charset=utf-8","--cache-control","no-cache, max-age=0, must-revalidate","--no-progress","--profile","rexrun","--region","ap-southeast-2"],{encoding:"utf8",windowsHide:true});
  if(r.status!==0) throw new Error(r.stderr);
}
const invalidation=call(["cloudfront","create-invalidation","--distribution-id",distribution.Id,"--paths","/","/index.html","/privacypolicy.html"]);
const report={publishedAt:new Date().toISOString(),webUrl,files:files.length,existingAssetsRetained:true,invalidationId:invalidation.Invalidation.Id};
writeFileSync(new URL(".cache/model-integration/web-publication.json",root),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
