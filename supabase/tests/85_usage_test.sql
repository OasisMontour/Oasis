-- Usage tracking: heartbeats can't inflate time, only admins read it, and it's aggregate-only for students.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000d9', 'stats.admin@oasis.dev', '{"provider":"google"}');
insert into admins (email) values ('stats.admin@oasis.dev');
insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000d8', 'stranger@gmail.com', '{"provider":"google"}');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select public.track_usage(true);
select public.track_usage(false);  -- immediately after the visit: ignored
select public.track_usage(false);
commit;
select tests.ok((select visits = 1 and active_s = 0 from usage_days where user_id = '00000000-0000-0000-0000-0000000000b1'), 'a visit counts once; spammed heartbeats add nothing');

-- 30s later: counted. 10 minutes later (closed laptop): new stretch, gap not counted.
update usage_days set last_beat_at = now() - interval '30 seconds' where user_id = '00000000-0000-0000-0000-0000000000b1';
begin; set local role authenticated; select tests.become('00000000-0000-0000-0000-0000000000b1'); select public.track_usage(false); commit;
select tests.ok((select active_s between 29 and 31 from usage_days where user_id = '00000000-0000-0000-0000-0000000000b1'), 'a heartbeat 30s later adds 30s');
update usage_days set last_beat_at = now() - interval '10 minutes' where user_id = '00000000-0000-0000-0000-0000000000b1';
begin; set local role authenticated; select tests.become('00000000-0000-0000-0000-0000000000b1'); select public.track_usage(false); commit;
select tests.ok((select active_s between 29 and 31 from usage_days where user_id = '00000000-0000-0000-0000-0000000000b1'), 'a 10 minute gap is not counted as time in app');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000a1');
select public.track_usage(true);
select tests.ok(tests.throws('select * from usage_days'), 'clients cannot read usage rows');
select tests.ok(tests.throws($$update usage_days set active_s = 99999$$), 'clients cannot write usage rows');
select tests.ok(tests.throws('select public.admin_usage()'), 'teacher cannot read usage analytics');

select tests.become('00000000-0000-0000-0000-0000000000d8');
select public.track_usage(true);
select tests.become('00000000-0000-0000-0000-0000000000d9');
select public.track_usage(true);
create temp table u as select public.admin_usage() as j;
select tests.ok((select (j #>> '{active,today_students}')::int >= 1 and (j #>> '{active,today_teachers}')::int >= 1 from u), 'admin sees today''s active students and teachers');
select tests.ok((select (j #>> '{active,visits_total}')::int >= 2 from u), 'visits are summed');
select tests.ok((select jsonb_array_length(j -> 'daily') = 30 from u), 'daily series covers 30 days');
select tests.ok((select (j #>> '{students_week,avg_active_s}')::int between 29 and 31 from u), 'student average time is reported');
commit;

select tests.ok(not exists (select 1 from usage_days where user_id = '00000000-0000-0000-0000-0000000000d8'), 'a Google account in no class is not tracked or counted');
select tests.ok((select (j #>> '{active,visits_total}')::int = 2 from u), 'admins'' own visits are left out of the numbers');
select tests.ok(not exists (select 1 from u, profiles x where x.role = 'student' and position(x.email in lower(u.j::text)) > 0),
  'no student email appears in usage analytics');
select tests.ok((select bool_and(r ->> 'email' in (select email from profiles where role = 'teacher')) from u, jsonb_array_elements(u.j -> 'teachers') r),
  'per-person rows are teachers only');

drop table u;
delete from usage_days;
delete from admins where email = 'stats.admin@oasis.dev';
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000d9');
delete from profiles where id in ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000d9');
\echo 'ALL USAGE TESTS PASSED'
