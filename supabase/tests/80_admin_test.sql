-- Admin RPCs: only admins listed server-side can manage the allowlist or see the overview, and the overview
-- carries no student-identifying data.
\set ON_ERROR_STOP on
\set QUIET on

-- An admin who is neither on the teacher allowlist nor on any roster (signs up as a plain student account).
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'Boss@Oasis.dev', '{"full_name":"Boss"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'early.teacher@district.org', '{"full_name":"Early Teacher"}', '{"provider":"google"}');
insert into admins (email) values ('boss@oasis.dev');
select count(*) as t1_classes from classes where teacher_id = '00000000-0000-0000-0000-0000000000a1' \gset

begin;
set local role authenticated;

-- ---------- non-admins: student, teacher
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok(not public.is_admin(), 'student is not an admin');
select tests.ok(tests.throws('select public.admin_dashboard()'), 'student cannot load the admin dashboard');
select tests.ok(tests.throws($$select public.admin_add_teacher('me@district.org')$$), 'student cannot add a teacher');
select tests.ok(tests.throws($$select public.admin_remove_teacher('t1@district.org')$$), 'student cannot remove a teacher');
select tests.ok(tests.throws('select * from admins'), 'clients cannot read the admins table');
select tests.ok(tests.throws($$insert into admins (email) values ('s1@district.org')$$), 'clients cannot add themselves as admin');
select tests.ok(tests.throws('select * from admin_audit'), 'clients cannot read the audit log directly');
select tests.ok(tests.throws($$update profiles set email = 'boss@oasis.dev' where id = auth.uid()$$), 'cannot take an admin''s email by editing your profile');
select tests.ok(tests.throws('select public.admin_email()'), 'admin_email() helper is not callable by clients');

select tests.become('00000000-0000-0000-0000-0000000000a1');
select tests.ok(not public.is_admin(), 'teacher is not an admin');
select tests.ok(tests.throws('select public.admin_dashboard()'), 'teacher cannot load the admin dashboard');
select tests.ok(tests.throws($$select public.admin_add_teacher('friend@district.org')$$), 'teacher cannot add a teacher');
select tests.ok(tests.throws('select * from teacher_allowlist'), 'teacher cannot read the allowlist directly');

-- ---------- admin
select tests.become('00000000-0000-0000-0000-0000000000d1');
select tests.ok(public.is_admin(), 'listed admin is an admin (email matched case-insensitively)');

create temp table d as select public.admin_dashboard() as j;
select tests.ok((select (j #>> '{totals,teachers}')::int >= 2 from d), 'totals count teachers');
select tests.ok((select (j #>> '{totals,assignments}')::int >= 1 from d), 'totals count assignments');
select tests.ok((select (r ->> 'classes')::int = :t1_classes and :t1_classes > 0
                   and (r ->> 'on_allowlist')::boolean and r ->> 'role' = 'teacher'
                 from d, jsonb_array_elements(j -> 'teachers') r where r ->> 'email' = 't1@district.org'),
  'teacher row shows allowlist status, role and class count');
select tests.ok((select jsonb_array_length(j -> 'assignments') >= 1 from d), 'assignments are listed');
select tests.ok((select bool_and(r ? 'started' and r ? 'finished' and r ? 'flagged') from d, jsonb_array_elements(j -> 'assignments') r),
  'each assignment has completion and flag counts');
select tests.ok((select (select string_agg(r ->> 'email', ',') from jsonb_array_elements(j -> 'teachers') r) not like '%s1@district.org%' from d),
  'students are not listed as teachers');
-- add: normalized, audited, validated
select tests.ok((public.admin_add_teacher('  New.Teacher@District.org ') ->> 'already_listed')::boolean = false, 'admin adds a teacher');
select tests.ok((public.admin_add_teacher('new.teacher@district.org') ->> 'already_listed')::boolean, 'adding twice reports already listed');
select tests.ok(tests.throws($$select public.admin_add_teacher('not an email')$$), 'invalid email is rejected');
select tests.ok(tests.throws($$select public.admin_add_teacher(null)$$), 'null email is rejected');

-- add someone who signed in before being listed: promoted
select tests.ok((public.admin_add_teacher('early.teacher@district.org') ->> 'promoted')::boolean, 'early sign-in with no classes is promoted');

-- add an enrolled student by mistake: refused, nothing changes
select tests.ok(tests.throws($$select public.admin_add_teacher('s1@district.org')$$), 'enrolled student cannot be made a teacher');

-- remove
select tests.ok((public.admin_remove_teacher('early.teacher@district.org') ->> 'demoted')::boolean, 'removing a signed-in teacher demotes them');
select tests.ok(tests.throws($$select public.admin_remove_teacher('nobody@district.org')$$), 'removing a non-teacher errors');

select tests.ok((select jsonb_array_length(public.admin_dashboard() -> 'audit') = 4), 'every allowlist change is in the audit log');
commit;

-- verify effects as superuser
select tests.ok(not exists (
  select 1 from d, profiles x
  where x.role = 'student' and x.id <> '00000000-0000-0000-0000-0000000000d1'
    and (position(x.email in lower(d.j::text)) > 0 or (x.name <> '' and position(x.name in d.j::text) > 0))),
  'no student email or name appears anywhere in the dashboard');
select tests.ok(exists (select 1 from teacher_allowlist where email = 'new.teacher@district.org' and added_by = 'boss@oasis.dev'), 'allowlist row stores the normalized email and who added it');
select tests.ok(not exists (select 1 from teacher_allowlist where email = 's1@district.org'), 'refused student was not added to the allowlist');
select tests.ok((select role from profiles where email = 's1@district.org') = 'student', 'refused student is still a student');
select tests.ok(not exists (select 1 from teacher_allowlist where email = 'early.teacher@district.org'), 'removed teacher is off the allowlist');
select tests.ok((select role from profiles where email = 'early.teacher@district.org') = 'student', 'removed teacher is a student again');

-- revoking admin takes effect immediately
delete from admins where email = 'boss@oasis.dev';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000d1');
select tests.ok(not public.is_admin(), 'deleted admin row revokes access immediately');
select tests.ok(tests.throws('select public.admin_dashboard()'), '...and the dashboard is refused');
commit;

-- leave shared fixtures as they were
drop table d;
delete from teacher_allowlist where email = 'new.teacher@district.org';
delete from admin_audit;
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2');
delete from profiles where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2');
\echo 'ALL ADMIN TESTS PASSED'
