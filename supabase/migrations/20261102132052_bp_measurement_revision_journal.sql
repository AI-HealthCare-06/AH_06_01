begin;

-- The game snapshot remains a compatibility cache. This journal is the
-- account-owned immutable source of measurement revisions and knowledge time.
create table public.bp_measurement_revisions (
  user_id uuid not null default auth.uid() references public.user_profiles on delete cascade,
  entry_key text not null,
  mutation_id uuid not null,
  parent_mutation_id uuid,
  payload jsonb not null,
  revision bigint not null default 0,
  available_at timestamptz not null default clock_timestamp(),
  primary key (user_id, entry_key, revision),
  unique (user_id, mutation_id)
);
create index bp_measurement_knowledge_time on public.bp_measurement_revisions(user_id,available_at);
alter table public.bp_measurement_revisions enable row level security;
revoke all on public.bp_measurement_revisions from public,anon,authenticated;
grant select on public.bp_measurement_revisions to authenticated;
-- Server identity, revision and receipt timestamp cannot be submitted directly.
grant insert(entry_key,mutation_id,parent_mutation_id,payload) on public.bp_measurement_revisions to authenticated;
create policy bp_owner_read on public.bp_measurement_revisions for select to authenticated
using ((select auth.uid())=user_id and exists (
  select 1 from public.user_consents c where c.user_id=(select auth.uid())
  and c.consent_type='health_cloud_storage' and c.version='health-cloud-v1' and c.revoked_at is null
));
create policy bp_owner_append on public.bp_measurement_revisions for insert to authenticated
with check ((select auth.uid())=user_id and exists (
  select 1 from public.user_consents c where c.user_id=(select auth.uid())
  and c.consent_type='health_cloud_storage' and c.version='health-cloud-v1' and c.revoked_at is null
));

create function public.validate_bp_revision_insert() returns trigger
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); v jsonb:=new.payload; m jsonb; head public.bp_measurement_revisions;
  d date; measured timestamptz; s numeric; b numeric;
begin
  if uid is null or new.user_id is distinct from uid then raise exception 'BP_AUTH_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.user_consents c where c.user_id=uid and c.consent_type='health_cloud_storage' and c.version='health-cloud-v1' and c.revoked_at is null)
    then raise exception 'BP_CONSENT_REQUIRED' using errcode='42501'; end if;
  -- Same owner lock/order as the existing game sync: concurrent append branches
  -- cannot both become the next revision, even for the first measurement.
  perform 1 from public.user_profiles where user_id=uid for update;
  if not found then raise exception 'BP_PROFILE_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>6000
     or not (v ?& array['recorded_on','slot','status','systolic','diastolic','unit','source','metadata'])
     or v-array['recorded_on','slot','status','systolic','diastolic','unit','source','metadata'] <> '{}'::jsonb
    then raise exception 'BP_INVALID_VALUE' using errcode='22023'; end if;
  if jsonb_typeof(v->'recorded_on') is distinct from 'string' or v->>'recorded_on' !~ '^\d{4}-\d{2}-\d{2}$'
    then raise exception 'BP_INVALID_DATE' using errcode='22023'; end if;
  d:=(v->>'recorded_on')::date;
  if to_char(d,'YYYY-MM-DD')<>v->>'recorded_on' or d>(clock_timestamp() at time zone 'Asia/Seoul')::date
     or not coalesce(v->>'slot' in ('morning','evening'),false) or not coalesce(v->>'status' in ('measured','deleted'),false)
     or v->>'unit' is distinct from 'mmHg' or not coalesce(v->>'source' in ('manual-survey','legacy-survey'),false)
     or new.entry_key is distinct from 'survey:'||(v->>'recorded_on')||':'||(v->>'slot')
    then raise exception 'BP_INVALID_VALUE' using errcode='22023'; end if;
  if v->>'status'='measured' then
    if jsonb_typeof(v->'systolic') is distinct from 'number' or jsonb_typeof(v->'diastolic') is distinct from 'number'
      then raise exception 'BP_INVALID_PRESSURE' using errcode='22023'; end if;
    s:=(v->>'systolic')::numeric; b:=(v->>'diastolic')::numeric;
    if s<>trunc(s) or b<>trunc(b) or b<10 or s>999 or s<=b
      then raise exception 'BP_INVALID_PRESSURE' using errcode='22023'; end if;
  elsif v->'systolic' is distinct from 'null'::jsonb or v->'diastolic' is distinct from 'null'::jsonb then
    raise exception 'BP_INVALID_TOMBSTONE' using errcode='22023';
  end if;
  m:=v->'metadata';
  if jsonb_typeof(m) is distinct from 'object' or not (m ?& array['timePrecision','measuredAt','setting','method','deviceLabel','protocolConfirmed'])
     or m-array['timePrecision','measuredAt','setting','method','deviceLabel','protocolConfirmed'] <> '{}'::jsonb
     or not coalesce(m->>'timePrecision' in ('minute','day'),false) or not coalesce(m->>'setting' in ('home','clinic','unknown'),false)
     or not coalesce(m->>'method' in ('upper-arm-cuff','wrist','other','unknown'),false)
     or jsonb_typeof(m->'deviceLabel') not in ('string','null')
     or jsonb_typeof(m->'protocolConfirmed') not in ('boolean','null')
    then raise exception 'BP_INVALID_METADATA' using errcode='22023'; end if;
  if jsonb_typeof(m->'deviceLabel')='string' and (length(btrim(m->>'deviceLabel'))<1 or length(m->>'deviceLabel')>80)
    then raise exception 'BP_INVALID_DEVICE' using errcode='22023'; end if;
  if m->>'timePrecision'='day' then
    if m->'measuredAt' is distinct from 'null'::jsonb then raise exception 'BP_INVALID_TIME_PRECISION' using errcode='22023'; end if;
  else
    if jsonb_typeof(m->'measuredAt') is distinct from 'string' or m->>'measuredAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$'
      then raise exception 'BP_INVALID_MEASUREMENT_TIME' using errcode='22023'; end if;
    measured:=(m->>'measuredAt')::timestamptz;
    if (measured at time zone 'Asia/Seoul')::date<>d or measured>clock_timestamp()
      then raise exception 'BP_FUTURE_MEASUREMENT' using errcode='22023'; end if;
  end if;
  if v->>'source'='legacy-survey' and m <> '{"timePrecision":"day","measuredAt":null,"setting":"unknown","method":"unknown","deviceLabel":null,"protocolConfirmed":null}'::jsonb
    then raise exception 'BP_INVENTED_LEGACY_METADATA' using errcode='22023'; end if;
  select * into head from public.bp_measurement_revisions r
    where r.user_id=uid and r.entry_key=new.entry_key order by r.revision desc limit 1;
  if new.parent_mutation_id is distinct from head.mutation_id then
    raise exception 'BP_MUTATION_CONFLICT' using errcode='P0001';
  end if;
  new.revision:=coalesce(head.revision,0)+1;
  new.available_at:=clock_timestamp();
  return new;
end $$;
revoke all on function public.validate_bp_revision_insert() from public,anon,authenticated;
create trigger validate_bp_revision_insert before insert on public.bp_measurement_revisions
for each row execute function public.validate_bp_revision_insert();

create function public.append_bp_history(p_commands jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); cmd jsonb; prior public.bp_measurement_revisions; inserted public.bp_measurement_revisions; acks jsonb:='[]';
begin
  if uid is null then raise exception 'BP_AUTH_REQUIRED' using errcode='42501'; end if;
  if not exists(select 1 from public.user_consents c where c.user_id=uid and c.consent_type='health_cloud_storage' and c.version='health-cloud-v1' and c.revoked_at is null)
    then raise exception 'BP_CONSENT_REQUIRED' using errcode='42501'; end if;
  if jsonb_typeof(p_commands) is distinct from 'array' or jsonb_array_length(p_commands)>50 or octet_length(p_commands::text)>200000
    then raise exception 'BP_INVALID_COMMANDS' using errcode='22023'; end if;
  perform 1 from public.user_profiles where user_id=uid for update;
  for cmd in select value from jsonb_array_elements(p_commands) loop
    if jsonb_typeof(cmd) is distinct from 'object' or not (cmd ?& array['mutation_id','entry_key','parent_mutation_id','value'])
      or cmd-array['mutation_id','entry_key','parent_mutation_id','value'] <> '{}'::jsonb
      or jsonb_typeof(cmd->'mutation_id') is distinct from 'string' or jsonb_typeof(cmd->'entry_key') is distinct from 'string'
      or jsonb_typeof(cmd->'parent_mutation_id') not in ('string','null')
      then raise exception 'BP_INVALID_COMMAND' using errcode='22023'; end if;
    select * into prior from public.bp_measurement_revisions r where r.user_id=uid and r.mutation_id=(cmd->>'mutation_id')::uuid;
    if found then
      if prior.entry_key is distinct from cmd->>'entry_key' or prior.parent_mutation_id is distinct from (cmd->>'parent_mutation_id')::uuid or prior.payload is distinct from cmd->'value'
        then raise exception 'BP_MUTATION_ID_REUSE' using errcode='P0001'; end if;
      inserted:=prior;
    else
      insert into public.bp_measurement_revisions(entry_key,mutation_id,parent_mutation_id,payload)
        values(cmd->>'entry_key',(cmd->>'mutation_id')::uuid,(cmd->>'parent_mutation_id')::uuid,cmd->'value') returning * into inserted;
    end if;
    acks:=acks||jsonb_build_array(jsonb_build_object('mutation_id',inserted.mutation_id,'revision',inserted.revision,'available_at',inserted.available_at));
  end loop;
  return jsonb_build_object('contract','bp-history-v1','acknowledgments',acks);
end $$;
revoke all on function public.append_bp_history(jsonb) from public,anon;
grant execute on function public.append_bp_history(jsonb) to authenticated;

create function public.bp_history_heads(p_after_key text default '', p_limit integer default 200) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'BP_AUTH_REQUIRED' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 200 or p_after_key is null then raise exception 'BP_INVALID_PAGE' using errcode='22023'; end if;
  if not exists(select 1 from public.user_consents c where c.user_id=auth.uid() and c.consent_type='health_cloud_storage' and c.version='health-cloud-v1' and c.revoked_at is null)
    then raise exception 'BP_CONSENT_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('command',jsonb_build_object('mutation_id',r.mutation_id,'entry_key',r.entry_key,'parent_mutation_id',r.parent_mutation_id,'value',r.payload),'revision',r.revision,'available_at',r.available_at) order by r.entry_key),'[]'::jsonb)
    into result from (select distinct on(entry_key) * from public.bp_measurement_revisions
      where user_id=auth.uid() and entry_key>p_after_key order by entry_key,revision desc limit p_limit) r;
  return jsonb_build_object('contract','bp-history-v1','records',result);
end $$;
revoke all on function public.bp_history_heads(text,integer) from public,anon;
grant execute on function public.bp_history_heads(text,integer) to authenticated;

create function public.bp_history_at(p_as_of timestamptz, p_start date, p_end date) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'BP_AUTH_REQUIRED' using errcode='42501'; end if;
  if p_as_of is null or p_as_of>clock_timestamp() or p_start is null or p_end is null or p_start>p_end or p_end-p_start>366
    then raise exception 'BP_INVALID_RANGE' using errcode='22023'; end if;
  if not exists(select 1 from public.user_consents c where c.user_id=auth.uid() and c.consent_type='health_cloud_storage' and c.version='health-cloud-v1' and c.revoked_at is null)
    then raise exception 'BP_CONSENT_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('command',jsonb_build_object('mutation_id',r.mutation_id,'entry_key',r.entry_key,'parent_mutation_id',r.parent_mutation_id,'value',r.payload),'revision',r.revision,'available_at',r.available_at) order by r.entry_key),'[]'::jsonb)
    into result from (select distinct on(entry_key) * from public.bp_measurement_revisions
      where user_id=auth.uid() and available_at<=p_as_of order by entry_key,revision desc) r
    where (r.payload->>'recorded_on')::date between p_start and p_end;
  return jsonb_build_object('contract','bp-history-v1','as_of',p_as_of,'records',result);
end $$;
revoke all on function public.bp_history_at(timestamptz,date,date) from public,anon;
grant execute on function public.bp_history_at(timestamptz,date,date) to authenticated;

commit;
