begin;

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '탐험가' check (length(display_name) between 1 and 80),
  avatar_id text check (length(avatar_id) <= 80),
  onboarding_completed boolean not null default false,
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.user_consents (
  user_id uuid not null references public.user_profiles on delete cascade,
  consent_type text not null check (consent_type in ('health_cloud_storage')),
  version text not null, granted_at timestamptz not null default now(), revoked_at timestamptz,
  primary key(user_id,consent_type,version)
);
create table public.health_profiles (
  user_id uuid primary key references public.user_profiles on delete cascade,
  age smallint check(age between 1 and 120), sex text check(sex in ('female','male')),
  height_cm numeric check(height_cm between 50 and 250), weight_kg numeric check(weight_kg between 1 and 500),
  onboarding_bp_text text check(length(onboarding_bp_text)<=20), fasting_glucose numeric check(fasting_glucose>0 and fasting_glucose<=1000),
  details jsonb not null default '{}' check(jsonb_typeof(details)='object'),
  updated_at timestamptz not null default now()
);
create table public.medications (
  user_id uuid not null references public.user_profiles on delete cascade,
  id text not null check(length(id) between 1 and 80 and id not like '%|%'),
  name text not null check(length(name) between 1 and 80), dose text not null default '' check(length(dose)<=80),
  condition text not null default '' check(length(condition)<=80), drug_class text not null default 'other',
  active boolean not null default true, archived boolean not null default false, updated_at timestamptz not null default now(),
  primary key(user_id,id)
);
create table public.medication_schedules (
  user_id uuid not null, medication_id text not null, schedule_time time not null,
  primary key(user_id,medication_id,schedule_time),
  foreign key(user_id,medication_id) references public.medications(user_id,id) on delete cascade
);
create table public.medication_doses (
  user_id uuid not null, medication_id text not null, dose_date date not null, schedule_time time not null,
  taken_at timestamptz not null default now(), source text not null default 'self_report',
  primary key(user_id,medication_id,dose_date,schedule_time),
  foreign key(user_id,medication_id) references public.medications(user_id,id) on delete cascade
);
create table public.quest_definitions (
  id text primary key, title text not null, target numeric not null check(target>0), unit text not null
);
insert into public.quest_definitions values
 ('medicine','약 복용하기',1,'check'),('meal','건강한 식사하기',1,'check'),
 ('walk','6000걸음 걷기',6000,'steps'),('water','물 8잔 마시기',8,'cups'),('sleep','수면 7시간',7,'hours');
create table public.daily_quest_progress (
  user_id uuid not null references public.user_profiles on delete cascade,
  quest_date date not null, quest_id text not null references public.quest_definitions,
  progress numeric not null default 0 check(progress>=0), target numeric not null check(target>0),
  completed_at timestamptz, source text not null default 'self_report', updated_at timestamptz not null default now(),
  primary key(user_id,quest_date,quest_id)
);
create table public.daily_steps (
  user_id uuid not null references public.user_profiles on delete cascade, step_date date not null,
  step_count integer not null check(step_count>=0), source text not null check(source in ('health-connect','healthkit')),
  synced_at timestamptz not null, primary key(user_id,step_date)
);
create table public.game_saves (
  user_id uuid primary key references public.user_profiles on delete cascade,
  revision bigint not null default 0 check(revision>=0), snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  updated_at timestamptz not null default now()
);
create table public.user_devices (
  user_id uuid not null references public.user_profiles on delete cascade, device_id uuid not null,
  platform text not null check(platform in ('web','android','ios')), app_version text not null default '',
  push_token text check(length(push_token)<=4096), push_enabled boolean not null default false,
  last_seen_at timestamptz not null default now(), primary key(user_id,device_id)
);
create table public.sync_batches (
  user_id uuid not null references public.user_profiles on delete cascade, batch_id uuid not null,
  device_id uuid not null, fingerprint text not null, response jsonb not null,
  received_at timestamptz not null default now(), primary key(user_id,batch_id)
);
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.user_profiles on delete cascade,
  event_key text not null, kind text not null default 'quest_completed',
  title text not null default 'REXRUN · 퀘스트 완료',
  body text not null default '오늘의 실천을 완료했어요. 모험을 이어가 보세요!',
  status text not null default 'pending' check(status in ('pending','processing','accepted','retry','no_device')),
  attempts integer not null default 0, created_at timestamptz not null default now(), accepted_at timestamptz,
  unique(user_id,event_key)
);
create index notification_pending_idx on public.notification_outbox(user_id,created_at) where status in ('pending','retry','no_device');
create table public.client_events (
  user_id uuid not null references public.user_profiles on delete cascade, event_id uuid not null,
  device_id uuid not null, event_type text not null check(event_type='connection_probe'),
  source text not null check(source in ('web','android','ios')), sent_at timestamptz not null,
  received_at timestamptz not null default now(), primary key(user_id,event_id)
);

-- No public access. Ownership is enforced in PostgreSQL as well as the API.
do $rls$ declare t text; begin
  foreach t in array array['user_profiles','user_consents','health_profiles','medications','medication_schedules','medication_doses','daily_quest_progress','daily_steps','game_saves','user_devices','sync_batches','client_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy owner_access on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  end loop;
end $rls$;
alter table public.quest_definitions enable row level security;
revoke all on public.quest_definitions from anon,authenticated;
grant select on public.quest_definitions to authenticated;
create policy authenticated_catalog on public.quest_definitions for select to authenticated using(true);
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon,authenticated;
grant select on public.notification_outbox to authenticated;
create policy own_notifications on public.notification_outbox for select to authenticated using((select auth.uid())=user_id);

create function public.queue_quest_completion() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.completed_at is not null and (tg_op='INSERT' or old.completed_at is null) then
    insert into public.notification_outbox(user_id,event_key)
    values(new.user_id,'quest/'||new.quest_date::text||'/'||new.quest_id) on conflict(user_id,event_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_quest_completion() from public,anon,authenticated;
create trigger quest_completion_notification after insert or update of completed_at on public.daily_quest_progress
for each row execute function public.queue_quest_completion();

create function public.sync_rexrun(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  uid uuid:=auth.uid(); bid uuid; did uuid; prior public.sync_batches; rev bigint; expected bigint;
  prof jsonb; med jsonb; item record; q record; g jsonb; day date; v numeric; done boolean; response jsonb;
begin
  if uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(p)<>'object' or octet_length(p::text)>250000 or p->>'consent_version'<>'health-cloud-v1' then
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

create function public.read_rexrun() returns jsonb language sql security invoker set search_path='' as $$
select jsonb_build_object(
 'user_id',auth.uid(),
 'profile',(select to_jsonb(p) from public.user_profiles p where p.user_id=auth.uid()),
 'health_profile',(select to_jsonb(h) from public.health_profiles h where h.user_id=auth.uid()),
 'game',(select jsonb_build_object('revision',s.revision,'snapshot',s.snapshot,'updated_at',s.updated_at) from public.game_saves s where s.user_id=auth.uid()),
 'medications',coalesce((select jsonb_agg(to_jsonb(m)||jsonb_build_object('times',(select jsonb_agg(to_char(s.schedule_time,'HH24:MI')) from public.medication_schedules s where s.user_id=m.user_id and s.medication_id=m.id))) from public.medications m where m.user_id=auth.uid() and not m.archived),'[]'::jsonb),
 'quest_progress',coalesce((select jsonb_agg(to_jsonb(q) order by q.quest_date desc,q.quest_id) from public.daily_quest_progress q where q.user_id=auth.uid() and q.quest_date>=(now() at time zone 'Asia/Seoul')::date-30),'[]'::jsonb),
 'taken',coalesce((select jsonb_object_agg(d.dose_date::text||'|'||d.medication_id||'|'||to_char(d.schedule_time,'HH24:MI'),true) from public.medication_doses d where d.user_id=auth.uid() and d.dose_date=(now() at time zone 'Asia/Seoul')::date),'{}'::jsonb)
);
$$;
revoke all on function public.read_rexrun() from public,anon;
grant execute on function public.read_rexrun() to authenticated;

commit;
