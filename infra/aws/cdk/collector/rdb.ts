type Event = { rawPath?: string; body?: string; isBase64Encoded?: boolean; headers?: Record<string,string|undefined>; requestContext?: { http?: { method?: string } } };
type Config = { url: string; key: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createHandler(config: Config, fetcher: typeof fetch = fetch) {
  return async (event: Event) => {
    const reply = (statusCode: number, data: unknown) => ({statusCode, headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'},body:JSON.stringify(data)});
    const method = event.requestContext?.http?.method;
    if (event.rawPath === '/health' && method === 'GET') return reply(200,{ok:true,storage:'supabase-postgres',ranker:false});
    const auth = event.headers?.authorization ?? event.headers?.Authorization;
    if (!auth?.startsWith('Bearer ') || auth.length > 8192) return reply(401,{error:'AUTH_REQUIRED'});
    const headers = {apikey:config.key, Authorization:auth, 'Content-Type':'application/json'};
    try {
      const userResult = await fetcher(`${config.url}/auth/v1/user`,{headers,signal:AbortSignal.timeout(6000)});
      if (!userResult.ok) return reply(401,{error:'SESSION_EXPIRED'});
      const user = await userResult.json() as {id:string};
      let payload: Record<string,unknown> = {};
      if (method === 'POST') {
        const body = event.isBase64Encoded ? Buffer.from(event.body??'','base64').toString('utf8') : event.body??'';
        if (Buffer.byteLength(body)>250000) return reply(413,{error:'BODY_TOO_LARGE'});
        try {payload=JSON.parse(body);} catch {return reply(400,{error:'INVALID_JSON'});}
        if (!payload || typeof payload!=='object' || Array.isArray(payload)) return reply(400,{error:'INVALID_BODY'});
      }
      let path: string, init: RequestInit;
      if (event.rawPath === '/v1/me' && method === 'GET') {
        path='/rest/v1/rpc/read_rexrun'; init={method:'POST',body:'{}'};
      } else if (event.rawPath === '/v1/sync' && method === 'POST') {
        if (!uuid.test(String(payload.batch_id)) || !uuid.test(String(payload.device_id)) || !Number.isSafeInteger(payload.base_revision) || Number(payload.base_revision)<0 || payload.consent_version!=='health-cloud-v1' || !payload.game || typeof payload.game!=='object') return reply(400,{error:'INVALID_SYNC'});
        path='/rest/v1/rpc/sync_rexrun'; init={method:'POST',body:JSON.stringify({p:payload})};
      } else if (event.rawPath === '/v1/devices/push' && method === 'POST') {
        if (!uuid.test(String(payload.device_id)) || !['android','ios','web'].includes(String(payload.platform)) || typeof payload.push_enabled!=='boolean' || (payload.push_token!=null && (typeof payload.push_token!=='string'||payload.push_token.length>4096))) return reply(400,{error:'INVALID_DEVICE'});
        if(payload.app_version!==undefined && (typeof payload.app_version!=='string' || !/^\d+\.\d+\.\d+$/.test(payload.app_version)))return reply(400,{error:'INVALID_APP_VERSION'});
        path='/rest/v1/user_devices?on_conflict=user_id,device_id';
        init={method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({user_id:user.id,device_id:payload.device_id,platform:payload.platform,...(payload.app_version?{app_version:payload.app_version}:{}),push_token:payload.push_token??null,push_enabled:payload.push_enabled,last_seen_at:new Date().toISOString()})};
      } else if (event.rawPath === '/v1/notifications/dispatch' && method === 'POST') {
        path='/functions/v1/rexrun-notify';init={method:'POST',body:'{}'};
      } else return reply(404,{error:'NOT_FOUND'});
      const result=await fetcher(`${config.url}${path}`,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(8000)});
      if (result.status===204 || (result.ok && event.rawPath==='/v1/devices/push')) return reply(200,{stored:true});
      const data = await result.json() as {message?:string;code?:string};
      if (!result.ok) {
        const conflict = data.code==='P0001' && ['SYNC_CONFLICT','BATCH_ID_CONFLICT'].some(v=>data.message?.includes(v));
        return reply(conflict?409:result.status===401?401:result.status===403?403:400,{error:conflict?'SYNC_CONFLICT':'STORAGE_REJECTED'});
      }
      return reply(200,data);
    } catch {
      // Do not log bearer tokens, health values or request bodies.
      return reply(503,{error:'STORAGE_UNAVAILABLE',retryable:true});
    }
  };
}
