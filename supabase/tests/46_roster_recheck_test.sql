-- Roster recheck: targets, rate limit, service role only.
\set ON_ERROR_STOP on
\set QUIET on
grant usage on schema public to service_role;
grant usage on schema tests to service_role;
grant execute on all functions in schema tests to service_role;
insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-0000000000a1', 'Recheck', 'dQw4w9WgXcQ', 100);
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000461', '20000000-0000-0000-0000-000000000461', '10000000-0000-0000-0000-000000000001');
insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000004b1', 'late.kid@district.org', '{"provider":"google"}');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000004b1');
select tests.ok(tests.throws($$select roster_recheck_target('00000000-0000-0000-0000-0000000004b1', '40000000-0000-0000-0000-000000000461')$$), 'students cannot call it directly');
commit;

set role service_role;
select roster_recheck_target('00000000-0000-0000-0000-0000000004b1', '40000000-0000-0000-0000-000000000461') as r1 \gset
select roster_recheck_target('00000000-0000-0000-0000-0000000004b1', '40000000-0000-0000-0000-000000000461') as r2 \gset
select roster_recheck_target('00000000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000461') as r3 \gset
select roster_recheck_target('00000000-0000-0000-0000-0000000004b1', '40000000-0000-0000-0000-00000000dead') as r4 \gset
reset role;
select tests.ok(:'r1'::jsonb ->> 'status' = 'recheck' and :'r1'::jsonb ->> 'course_id' = 'gc-fixture'
  and :'r1'::jsonb ->> 'teacher_id' = '00000000-0000-0000-0000-0000000000a1', 'first open: recheck the class with its teacher');
select tests.ok(:'r2'::jsonb ->> 'status' = 'limited', 'second open within 10 minutes is limited');
select tests.ok(:'r3'::jsonb ->> 'status' = 'not_found', 'teachers are not rechecked');
select tests.ok(:'r4'::jsonb ->> 'status' = 'not_found', 'unknown assignment');
update roster_rechecks set at = now() - interval '11 minutes';
insert into enrollments (class_id, student_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000004b1');
set role service_role;
select tests.ok(roster_recheck_target('00000000-0000-0000-0000-0000000004b1', '40000000-0000-0000-0000-000000000461') ->> 'status' = 'enrolled', 'already enrolled: nothing to do');
reset role;
delete from enrollments where student_id = '00000000-0000-0000-0000-0000000004b1';
delete from lessons where id = '20000000-0000-0000-0000-000000000461';
\echo 'ALL ROSTER RECHECK TESTS PASSED'
