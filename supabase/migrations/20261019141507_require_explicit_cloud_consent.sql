create or replace function public.sync_rexrun(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  uid uuid:=auth.uid(); bid uuid; did uuid; prior public.sync_batches; rev bigint; expected bigint;
  prof jsonb; med jsonb; item record; q record; g jsonb; day date; v numeric; done boolean; response jsonb;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(p)<>'object' or octet_length(p::text)>250000 or p->>'consent_version' is distinct from 'health-cloud-v1' then
    raise exception 'INVALID_SYNC_PAYLOAD' using errcode='22023';
  end if;
  bid:=(p->>'batch_id')::uuid; did:=(p->>'device_id')::uuid; expected:=(p->>'base_revision')::bigint;
  if bid is null or did is null or expected is null then raise exception 'MISSING_SYNC_ID' using errcode='22023'; end if;
  insert into public.user_profiles(user_id) values(uid) on conflict(user_id) do nothing;
  perform 1 from public.user_profiles where user_id=uid for update;
  select * into prior from public.sync_batches where user_id=uid and batch_id=bid;
  if found then
    if prior.fingerprint<>md5(p::text) then raise exception 'BATCH_ID_CONFLICT' using errcode='P0001'; end if;
    return prior.response||jsonb_build_object('duplicate',true);
  end if;
  select revision into rev from public.game_saves where user_id=uid;
  rev:=coalesce(rev,0);
  if expected<>rev then raise exception 'SYNC_CONFLICT' using errcode='P0001'; end if;
  insert into public.user_consents(user_id,consent_type,version) values(uid,'health_cloud_storage','health-cloud-v1')
  on conflict(user_id,consent_type,version) do update set revoked_at=null;
  prof:=p->'profile'; g:=p->'game';
  if jsonb_typeof(g)<>'object' or g->>'date' is null then raise exception 'INVALID_GAME' using errcode='22023'; end if;
  day:=(g->>'date')::date;
  if day>(now() at time zone 'Asia/Seoul')::date+1 then raise exception 'FUTURE_DATE' using errcode='22023'; end if;
  update public.user_profiles set avatar_id=nullif(p->>'avatar_id',''), onboarding_completed=coalesce((p->>'onboarding_completed')::boolean,false),updated_at=now() where user_id=uid;
  if prof is not null and prof<>'null'::jsonb then
    update public.user_profiles set display_name=left(coalesce(nullif(prof->>'name',''),'탐험가'),80) where user_id=uid;
    insert into public.health_profiles(user_id,age,sex,height_cm,weight_kg,onboarding_bp_text,fasting_glucose,details)
    values(uid,(prof->>'age')::smallint,prof->>'sex',(prof->>'height')::numeric,(prof->>'weight')::numeric,prof->>'bloodPressure',(prof->>'glucose')::numeric,prof-'name'-'age'-'sex'-'height'-'weight'-'bloodPressure'-'glucose')
    on conflict(user_id) do update set age=excluded.age,sex=excluded.sex,height_cm=excluded.height_cm,weight_kg=excluded.weight_kg,onboarding_bp_text=excluded.onboarding_bp_text,fasting_glucose=excluded.fasting_glucose,details=excluded.details,updated_at=now();
  end if;
  if jsonb_typeof(p->'medications')='array' then
    if jsonb_array_length(p->'medications')>12 then raise exception 'TOO_MANY_MEDICATIONS' using errcode='22023'; end if;
    update public.medications set archived=true,active=false where user_id=uid and id not in (select e->>'id' from jsonb_array_elements(p->'medications') e);
    for med in select * from jsonb_array_elements(p->'medications') loop
      insert into public.medications(user_id,id,name,dose,condition,drug_class,active)
      values(uid,med->>'id',med->>'name',coalesce(med->>'dose',''),coalesce(med->>'condition',''),coalesce(med->>'drugClass','other'),coalesce((med->>'active')::boolean,true))
      on conflict(user_id,id) do update set name=excluded.name,dose=excluded.dose,condition=excluded.condition,drug_class=excluded.drug_class,active=excluded.active,archived=false,updated_at=now();
      delete from public.medication_schedules where user_id=uid and medication_id=med->>'id';
      insert into public.medication_schedules select uid,med->>'id',value::time from jsonb_array_elements_text(med->'times');
    end loop;
  end if;
  for item in select key,value from jsonb_each(coalesce(p->'taken','{}'::jsonb)) loop
    if item.value='true'::jsonb and array_length(string_to_array(item.key,'|'),1)=3 and exists(select 1 from public.medications where user_id=uid and id=split_part(item.key,'|',2)) then
      insert into public.medication_doses(user_id,medication_id,dose_date,schedule_time)
      values(uid,split_part(item.key,'|',2),split_part(item.key,'|',1)::date,split_part(item.key,'|',3)::time) on conflict do nothing;
    end if;
  end loop;
  for q in select * from public.quest_definitions loop
    done:=coalesce((g->'completed') ? q.id,false);
    v:=case q.id when 'walk' then coalesce((g#>>'{steps,count}')::numeric,0) when 'water' then coalesce((g#>>'{activity,water}')::numeric,0) when 'sleep' then coalesce((g->>'sleepHours')::numeric,0) else 0 end;
    if done then v:=greatest(v,q.target); end if;
    insert into public.daily_quest_progress(user_id,quest_date,quest_id,progress,target,completed_at,source)
    values(uid,day,q.id,greatest(v,0),q.target,case when done then now() end,case when q.id='walk' and g#>>'{steps,source}' is not null then g#>>'{steps,source}' else 'self_report' end)
    on conflict(user_id,quest_date,quest_id) do update set progress=greatest(daily_quest_progress.progress,excluded.progress), completed_at=coalesce(daily_quest_progress.completed_at,excluded.completed_at),source=excluded.source,updated_at=now();
  end loop;
  if jsonb_typeof(g->'steps')='object' then
    insert into public.daily_steps values(uid,(g#>>'{steps,date}')::date,(g#>>'{steps,count}')::integer,g#>>'{steps,source}',to_timestamp((g#>>'{steps,syncedAt}')::double precision/1000))
    on conflict(user_id,step_date) do update set step_count=excluded.step_count,source=excluded.source,synced_at=excluded.synced_at where excluded.synced_at>=daily_steps.synced_at;
  end if;
  insert into public.game_saves(user_id,revision,snapshot) values(uid,rev+1,g-'debugBuffs')
  on conflict(user_id) do update set revision=excluded.revision,snapshot=excluded.snapshot,updated_at=now();
  insert into public.user_devices(user_id,device_id,platform,app_version) values(uid,did,coalesce(p->>'platform','web'),left(coalesce(p->>'app_version',''),80))
  on conflict(user_id,device_id) do update set app_version=excluded.app_version,last_seen_at=now();
  response:=jsonb_build_object('batch_id',bid,'revision',rev+1,'stored',true,'received_at',now(),'duplicate',false);
  insert into public.sync_batches(user_id,batch_id,device_id,fingerprint,response) values(uid,bid,did,md5(p::text),response);
  return response;
end $$;
revoke all on function public.sync_rexrun(jsonb) from public,anon;
grant execute on function public.sync_rexrun(jsonb) to authenticated;

