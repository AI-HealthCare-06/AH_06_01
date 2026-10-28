import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {createClient}=require('@supabase/supabase-js');
const config=JSON.parse(readFileSync(new URL('../../frontend/cloud.config.json',import.meta.url)));
const result=spawnSync('npx.cmd',['--offline','supabase@2.121.0','projects','api-keys','--project-ref','bjyanmywcclymklgcrhi','--output','json'],{shell:true,encoding:'utf8',windowsHide:true});
if(result.status!==0)throw new Error('Supabase server configuration access unavailable');
const adminKey=JSON.parse(result.stdout).find(x=>x.name==='service_role')?.api_key;
if(!adminKey)throw new Error('Server configuration key unavailable');
const client=createClient(config.supabaseUrl,adminKey,{auth:{persistSession:false,autoRefreshToken:false}});
const listed=await client.auth.admin.customProviders.listProviders();if(listed.error)throw new Error(`Provider list failed: ${listed.error.code??listed.error.status}`);
const credentialsDirectory=process.env.REXRUN_SOCIAL_CREDENTIALS_DIR;
if(!credentialsDirectory)throw new Error('Set REXRUN_SOCIAL_CREDENTIALS_DIR to the ignored directory containing provider-oauth.private.json files');
const report=[];
for (const [name,host] of [['naver','nid.naver.com'],['kakao','kauth.kakao.com']]) {
 const credentials=JSON.parse(readFileSync(`${credentialsDirectory}/${name}-oauth.private.json`));
 if(!credentials.client_id||!credentials.client_secret)throw new Error('Missing server OAuth credential');
 const params={provider_type:'oidc',identifier:`custom:${name}`,name:name==='naver'?'Naver':'Kakao',...credentials,issuer:`https://${host}`,discovery_url:`https://${host}/.well-known/openid-configuration`,scopes:['openid'],pkce_enabled:true,email_optional:true,enabled:true};
 const existing=listed.data.providers.find(x=>x.identifier===params.identifier);
 const configured=existing?await client.auth.admin.customProviders.updateProvider(params.identifier,params):await client.auth.admin.customProviders.createProvider(params);
 if(configured.error)throw new Error(`${name} configuration failed: ${configured.error.code??configured.error.status} ${configured.error.message?.replaceAll(credentials.client_secret,'[redacted]')}`);
 report.push({identifier:configured.data.identifier,provider_type:configured.data.provider_type,enabled:configured.data.enabled,scopes:configured.data.scopes,pkce_enabled:configured.data.pkce_enabled,email_optional:configured.data.email_optional});
}
writeFileSync(new URL('../../.cache/deployment/social-providers-configured.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
