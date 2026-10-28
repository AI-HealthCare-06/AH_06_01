begin;
alter table public.quest_definitions add column quest_group text not null default 'main' check (quest_group in ('main','sub'));
update public.quest_definitions set title='물 마시기 실천',target=1,unit='check',quest_group='sub' where id='water';
insert into public.quest_definitions(id,title,target,unit,quest_group) values ('survey','오늘의 건강 서베이',1,'check','main');
comment on column public.quest_definitions.quest_group is 'Main daily completion excludes optional water; historical progress remains unchanged.';
commit;
