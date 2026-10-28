begin;
update public.quest_definitions set title = '약 / 영양제 복용' where id = 'medicine';
update public.quest_definitions set title = '수면 기록 보너스', quest_group = 'sub' where id = 'sleep';
create or replace function public.queue_quest_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
declare quest_title text;
begin
  if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
    select title into quest_title from public.quest_definitions where id = new.quest_id;
    insert into public.notification_outbox(user_id,event_key,title,body)
    values(new.user_id,'quest/'||new.quest_date::text||'/'||new.quest_id,
      'REXRUN · '||coalesce(quest_title,'퀘스트')||' 완료',
      coalesce(quest_title,'퀘스트')||' 퀘스트를 완료했어요.')
    on conflict(user_id,event_key) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.queue_quest_completion() from public,anon,authenticated;
commit;
