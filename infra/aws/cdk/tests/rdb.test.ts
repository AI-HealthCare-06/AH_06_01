import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../collector/rdb.js';
const config={url:'https://test.supabase.co',key:'public-key'};
test('health is public, storage routes reject missing and invalid authentication',async()=>{
 const handler=createHandler(config,async()=>new Response('{}',{status:401}));
 assert.equal((await handler({rawPath:'/health',requestContext:{http:{method:'GET'}}})).statusCode,200);
 assert.equal((await handler({rawPath:'/v1/me',requestContext:{http:{method:'GET'}}})).statusCode,401);
 assert.equal((await handler({rawPath:'/v1/me',headers:{authorization:'Bearer expired'},requestContext:{http:{method:'GET'}}})).statusCode,401);
});
test('device owner always comes from verified identity, never the request body',async()=>{
 const calls:Array<{url:string;body:unknown}>=[];
 const handler=createHandler(config,async(url,init)=>{calls.push({url:String(url),body:init?.body});return calls.length===1?Response.json({id:'verified-user'}):new Response(null,{status:204});});
 const response=await handler({rawPath:'/v1/devices/push',requestContext:{http:{method:'POST'}},headers:{authorization:'Bearer token'},body:JSON.stringify({device_id:'550e8400-e29b-41d4-a716-446655440000',platform:'android',push_enabled:true,push_token:'opaque-token',app_version:'1.5.0',user_id:'attacker-selected-owner'})});
 assert.equal(response.statusCode,200);assert.equal(JSON.parse(String(calls[1].body)).user_id,'verified-user');assert.equal(JSON.parse(String(calls[1].body)).app_version,'1.5.0');
});
test('revision conflicts are explicit and request/credential data is never reflected',async()=>{
 let count=0;const handler=createHandler(config,async()=>++count===1?Response.json({id:'user'}):Response.json({code:'P0001',message:'SYNC_CONFLICT secret'},{status:400}));
 const response=await handler({rawPath:'/v1/sync',requestContext:{http:{method:'POST'}},headers:{authorization:'Bearer private-token'},body:JSON.stringify({batch_id:'550e8400-e29b-41d4-a716-446655440000',device_id:'550e8400-e29b-41d4-a716-446655440000',base_revision:0,consent_version:'health-cloud-v1',game:{date:'2026-10-19'}})});
 assert.equal(response.statusCode,409);assert.ok(!response.body.includes('secret'));assert.ok(!response.body.includes('private-token'));
});
