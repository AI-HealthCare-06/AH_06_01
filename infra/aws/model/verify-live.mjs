// Serving checks using freshly provisioned synthetic test accounts only.
// No user records, passwords, bearer tokens or response health values are logged.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
const root=new URL("../../../",import.meta.url);
const config=JSON.parse(readFileSync(new URL("frontend/cloud.config.json",root)));
const fixture=JSON.parse(readFileSync(new URL(".cache/deployment/fixtures.private.json",root)));
const sample=JSON.parse(readFileSync(new URL("ai/m1_stage/docs/sample_input.json",root)));
const results=[];
const pause=()=>new Promise(resolve=>setTimeout(resolve,650));
async function login(user){
  const response=await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`,{
    method:"POST",headers:{apikey:config.publishableKey,"content-type":"application/json"},
    body:JSON.stringify({email:user.email,password:user.password}),signal:AbortSignal.timeout(15000),
  });
  assert.equal(response.status,200,"Synthetic fixture login failed");
  const data=await response.json();
  assert.equal(data.user.id,user.id,"Fixture identity mismatch");
  return data.access_token;
}
async function api(path,body,token){
  await pause();
  const response=await fetch(`${config.apiUrl}${path}`,{
    method:body===undefined?"GET":"POST",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(35000),
  });
  return {status:response.status,data:await response.json(),cache:response.headers.get("cache-control")};
}
const health=await api("/predictions/bp-stage/health");
assert.equal(health.status,200);assert.equal(health.data.ready,true);
results.push("Linux runtime loads the pinned model");
const [a,b]=fixture.users;
if(![a,b].every(u=>/^rexrun-synthetic-[a-f0-9]+-[01]@example\.invalid$/.test(u.email))) throw new Error("Fresh synthetic fixtures required");
const token=await login(a);
assert.equal((await api("/v1/predictions/bp-stage",{},token)).status,403);
results.push("A valid session without health storage consent is rejected");
const tokenB=await login(b);
const profile={name:"Synthetic Model Test",age:52,sex:"male",height:170,weight:75,bloodPressure:null,
  glucose:102,smoking:false,hypertensionFamily:false,diabetesFamily:false,conditions:[],specialHistory:"",
  pregnancyStatus:"none",htnStatus:"none",alcoholDays:0,sleepHours:7,activeMinutesWeek:150,familyHistory:[]};
const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
for(const [t,p] of [[token,profile],[tokenB,{...profile,bloodPressure:"128 / 82"}]]){
  const r=await api("/v1/sync",{batch_id:randomUUID(),device_id:randomUUID(),base_revision:0,
    consent_version:"health-cloud-v1",platform:"web",app_version:"model-integration-test",
    game:{date:day,completed:[],activity:{water:0},sleepHours:0},profile:p,medications:[],taken:{},
    avatar_id:null,onboarding_completed:true},t);
  assert.equal(r.status,200);assert.equal(r.data.stored,true);
}
results.push("Fresh synthetic profiles are stored through the normal AWS sync API");
const response=await api("/predictions/bp-stage",sample,token);
assert.equal(response.status,200);assert.equal(response.cache,"no-store");
assert.deepEqual(response.data.stage_probs,{normal:0.1744,elevated:0.0901,prehtn:0.4187,htn:0.3168});
assert.equal(response.data.stage_top,"prehtn");assert.equal(response.data.data_quality,"ok");
results.push("Original model example probabilities match exactly");
for (const [payload,quality] of [[{...sample,age:95},"out_of_range"],[{...sample,sbp:128},"not_applicable"],[{...sample,htn_med:true},"not_applicable"]]){
  const r=await api("/predictions/bp-stage",payload,token);
  assert.equal(r.status,200);assert.equal(r.data.data_quality,quality);assert.equal(r.data.stage_probs,null);
}
results.push("Domain refusals remain 200 with null probabilities");
assert.equal((await api("/v1/predictions/bp-stage",{})).status,401);
assert.equal((await api("/v1/predictions/bp-stage",{},"synthetic-invalid-token")).status,401);
assert.equal((await api("/v1/predictions/bp-stage",{user_id:b.id},token)).status,400);
results.push("Missing/invalid sessions and cross-user selection are rejected");
const remote=await api("/v1/me",undefined,token);
assert.equal(remote.status,200);
const stored=await api("/v1/predictions/bp-stage",{},token);
assert.equal(stored.status,200);
assert.equal(stored.data.data_quality,"partial");
if(remote.data.health_profile?.onboarding_bp_text){
  assert.equal(stored.data.data_quality,"not_applicable");assert.equal(stored.data.stage_probs,null);
}
assert.equal(stored.data.model_version,"M1-20261020_150607-nested__base");
results.push("Stored profile is read through caller JWT and existing RLS");
const other=await api("/v1/predictions/bp-stage",{},tokenB);
assert.equal(other.status,200);assert.equal(other.data.data_quality,"not_applicable");
assert.equal(other.data.stage_probs,null);
results.push("The second account receives its own measured-BP exclusion, not the first account result");
const report={checkedAt:new Date().toISOString(),syntheticFixturesOnly:true,realUserData:false,mutatedOnlyFreshSyntheticUsers:true,
  modelVersion:stored.data.model_version,checks:results};
writeFileSync(new URL(".cache/model-integration/live-verification.json",root),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
