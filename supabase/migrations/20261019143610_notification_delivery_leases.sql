alter table public.notification_outbox add column claimed_at timestamptz;
create function public.claim_rexrun_notifications(owner_id uuid) returns setof public.notification_outbox language sql security invoker set search_path='' as $$
 update public.notification_outbox n set status='processing',attempts=n.attempts+1,claimed_at=now()
 where n.id in (select o.id from public.notification_outbox o where o.user_id=owner_id and o.created_at>now()-interval '24 hours' and (o.status in ('pending','retry','no_device') or (o.status='processing' and o.claimed_at<now()-interval '2 minutes')) order by o.created_at for update skip locked limit 5)
 returning n.*;
$$;
revoke all on function public.claim_rexrun_notifications(uuid) from public,anon,authenticated;
grant execute on function public.claim_rexrun_notifications(uuid) to service_role;
