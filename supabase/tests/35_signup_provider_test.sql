-- Red-team regression (Nov 23): signups through any provider but Google are refused, so nobody can claim a
-- teacher's or student's email with a password signup.
\set ON_ERROR_STOP on
\set QUIET on

insert into teacher_allowlist (email) values ('late.teacher@district.org');
insert into roster_entries (class_id, email, name) values ('10000000-0000-0000-0000-000000000001', 'late.kid@district.org', 'Late Kid');

select tests.ok(tests.throws($$insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'late.teacher@district.org', '{"provider":"email","providers":["email"]}')$$),
  'password signup with an allowlisted teacher email is refused');
select tests.ok(not exists (select 1 from profiles where email = 'late.teacher@district.org'), '...and no profile was created');

select tests.ok(tests.throws($$insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000e2', 'late.kid@district.org', '{"provider":"email","providers":["email"]}')$$),
  'password signup with a rostered student email is refused');
select tests.ok(tests.throws($$insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000e3', 'late.kid@district.org', '{"provider":"github"}')$$),
  'other OAuth providers are refused too');

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000e4', 'Late.Teacher@district.org', '{"full_name":"Late Teacher"}', '{"provider":"google","providers":["google"]}'),
  ('00000000-0000-0000-0000-0000000000e5', 'late.kid@district.org', '{"full_name":"Late Kid"}', '{"provider":"google","providers":["google"]}');
select tests.ok((select role from profiles where id = '00000000-0000-0000-0000-0000000000e4') = 'teacher', 'Google signup with an allowlisted email is a teacher');
select tests.ok(exists (select 1 from enrollments where student_id = '00000000-0000-0000-0000-0000000000e5'
  and class_id = '10000000-0000-0000-0000-000000000001'), 'Google signup with a rostered email is enrolled');
select tests.ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'), 'handle_new_user is not callable through the API');

-- leave the shared fixtures as they were for later test files
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e5');
delete from profiles where id in ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e5');
delete from roster_entries where email = 'late.kid@district.org';
\echo 'ALL SIGNUP PROVIDER TESTS PASSED'
