import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const aws='C:/Program Files/Amazon/AWSCLIV2/aws.exe';
function call(args){const r=spawnSync(aws,[...args,'--profile','rexrun','--region','ap-southeast-2','--output','json'],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr);return r.stdout.trim()?JSON.parse(r.stdout):null;}
const identity=call(['sts','get-caller-identity']);if(identity.Account!=='862330372849')throw new Error('Unexpected AWS account');
const outputs=call(['cloudformation','describe-stacks','--stack-name','rexrun-test-artifacts']).Stacks[0].Outputs;
const bucket=outputs.find(o=>o.OutputKey==='BucketName').OutputValue;
const zip=new URL('./.cache/collector.zip',import.meta.url), key=`collector/${createHash('sha256').update(readFileSync(zip)).digest('hex')}.zip`;
const upload=call(['s3api','put-object','--bucket',bucket,'--key',key,'--body',decodeURIComponent(zip.pathname).replace(/^\/([A-Z]:)/,'$1')]);
const config=JSON.parse(readFileSync(new URL('../../frontend/cloud.config.json',import.meta.url)));
const params=[{ParameterKey:'CollectorCodeKey',ParameterValue:key},{ParameterKey:'CollectorCodeVersion',ParameterValue:upload.VersionId},{ParameterKey:'SupabasePublishableKey',ParameterValue:config.publishableKey}];
writeFileSync(new URL('./.cache/collector-parameters.json',import.meta.url),JSON.stringify(params));
console.log(JSON.stringify({account:identity.Account,artifactUploaded:true,key,versioned:!!upload.VersionId}));
