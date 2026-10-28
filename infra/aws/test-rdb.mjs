import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes} from 'node:crypto';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {createClient}=require('@supabase/supabase-js');
const config=JSON.parse(readFileSync(new URL('../../frontend/cloud.config.json',import.meta.url)));
const keys=spawnSync('npx.cmd',['--offline','supabase@2.121.0','projects','api-keys','--project-ref','bjyanmywcclymklgcrhi','--output','json'],{shell:true,encoding:'utf8',windowsHide:true});
if(keys.status!==0)throw new Error('Cannot obtain temporary admin client for synthetic test');
const list=JSON.parse(keys.stdout);const adminKey=list.find(k=>k.name==='service_role')?.api_key;
if(!adminKey)throw new Error('Admin test key unavailable');
const admin=createClient(config.supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
const run=randomUUID().slice(0,8),users=[];
for(let i=0;i<2;i++){
 const email=`rexrun-synthetic-${run}-${i}@example.invalid`,password=randomBytes(24).toString('base64url');
 const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{rexrun_test_run:run}});if(error)throw new Error(error.message);
 const client=createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:false}});
 const login=await client.auth.signInWithPassword({email,password});if(login.error)throw new Error(login.error.message);
 users.push({email,password,id:data.user.id,token:login.data.session.access_token});
}
mkdirSync(new URL('../../.cache/deployment/',import.meta.url),{recursive:true});
writeFileSync(new URL('../../.cache/deployment/fixtures.private.json',import.meta.url),JSON.stringify({run,users}));
console.log(JSON.stringify({syntheticUsersCreated:users.length,run,credentials:'saved only in ignored local fixture'}));
