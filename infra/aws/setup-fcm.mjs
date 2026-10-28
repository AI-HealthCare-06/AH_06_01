import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const r=spawnSync('npx.cmd',['--offline','firebase-tools@15.34.0','login:list','--json'],{shell:true,encoding:'utf8',windowsHide:true});
const account=JSON.parse(r.stdout).result.find(a=>a.user.email==='awskcj@gmail.com');if(!account)throw new Error('Expected Google account missing');
const token=account.tokens.access_token;
async function api(url,method='GET',body){const response=await fetch(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(`${method} ${new URL(url).host}: ${response.status} ${data.error?.message}`);return data;}
const project='rexrun-mobile-test',sa='rexrun-quest-push';
for(const service of ['iam.googleapis.com','cloudresourcemanager.googleapis.com','fcm.googleapis.com']){
 const state=await api(`https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}`);
 if(state.state!=='ENABLED')await api(`https://serviceusage.googleapis.com/v1/projects/${project}/services/${service}:enable`,'POST',{});
}
const accountUrl=`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts/${sa}@${project}.iam.gserviceaccount.com`;
let serviceAccount;
try{serviceAccount=await api(accountUrl);}catch(e){if(!e.message.includes('404'))throw e;serviceAccount=await api(`https://iam.googleapis.com/v1/projects/${project}/serviceAccounts`,'POST',{accountId:sa,serviceAccount:{displayName:'REXRUN quest completion push only'}});}
const roleName=`projects/${project}/roles/rexrunQuestPushSender`;
try{await api(`https://iam.googleapis.com/v1/${roleName}`);}catch(e){if(!e.message.includes('404'))throw e;await api(`https://iam.googleapis.com/v1/projects/${project}/roles`,'POST',{roleId:'rexrunQuestPushSender',role:{title:'REXRUN Quest Push Sender',description:'Send generic quest completion messages only',includedPermissions:['cloudmessaging.messages.create'],stage:'GA'}});}
const policy=await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:getIamPolicy`,'POST',{});
const member=`serviceAccount:${serviceAccount.email}`;let binding=policy.bindings.find(b=>b.role===roleName);
if(!binding){binding={role:roleName,members:[]};policy.bindings.push(binding);}if(!binding.members.includes(member)){binding.members.push(member);await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:setIamPolicy`,'POST',{policy});}
const key=await api(`${accountUrl}/keys`,'POST',{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});
mkdirSync('.cache/deployment',{recursive:true});
writeFileSync('.cache/deployment/fcm-secrets.env',`FCM_SERVICE_ACCOUNT_JSON_B64=${key.privateKeyData}\n`);
writeFileSync('.cache/deployment/fcm-key-metadata.json',JSON.stringify({project,serviceAccount:serviceAccount.email,role:roleName,keyName:key.name,createdAt:new Date().toISOString()},null,2));
console.log(JSON.stringify({project,serviceAccount:serviceAccount.email,permission:'cloudmessaging.messages.create',privateKey:'written only to ignored deployment secret file'}));
