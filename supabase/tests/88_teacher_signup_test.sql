-- Teacher self-signup through Google Classroom: the role is granted only by claim_teacher_for (service role,
-- fed by the classroom Edge Function), and only on Google's say-so plus admin-controlled rules.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'boss2@oasis.dev', '{"full_name":"Boss Two"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'New.T@district.org', '{"full_name":"New Teacher"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000e3', 'ver@other.edu', '{"full_name":"Verified"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000e4', 'kid@gmail.com', '{"full_name":"Totally A Teacher"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000e5', 'rost@district.org', '{"full_name":"On A Roster"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000e6', 'x@evil.org', '{"full_name":"Own Workspace"}', '{"provider":"google"}'),
  ('00000000-0000-0000-0000-0000000000e7', 'pend@district2.org', '{"full_name":"Pending Person"}', '{"provider":"google"}');
insert into admins (email) values ('boss2@oasis.dev');
-- rost@ shows up on a Classroom roster *after* signing in (so not enrolled yet, but a roster says student).
insert into roster_entries (class_id, email, name) values ('10000000-0000-0000-0000-000000000001', 'rost@district.org', 'On A Roster');

create function tests.ev(email text, hd text, verified boolean, courses int) returns jsonb language sql as $$
  select jsonb_build_object('google_email', email, 'hosted_domain', hd, 'verified_teacher', verified,
                            'active_courses', courses, 'students', 25, 'course_names', jsonb_build_array('Period 1', 'Period 2'));
$$;

-- ---------- clients can't reach any of it directly
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000e4');
select tests.ok(tests.throws($$select public.claim_teacher_for(auth.uid(), tests.ev('kid@gmail.com', null, true, 3))$$),
  'a browser cannot call the role grant itself');
select tests.ok(tests.throws('select * from teacher_requests'), 'clients cannot read sign-up requests');
select tests.ok(tests.throws($$insert into teacher_requests (user_id, status, via) values (auth.uid(), 'approved', 'admin')$$),
  'clients cannot write a sign-up request');
select tests.ok(tests.throws($$insert into teacher_domains (domain) values ('gmail.com')$$), 'clients cannot approve a domain');
select tests.ok(tests.throws('delete from teacher_blocks'), 'clients cannot clear blocks');
select tests.ok(tests.throws($$update profiles set role = 'teacher' where id = auth.uid()$$), 'clients cannot set their own role');
select tests.ok(tests.throws($$select public.admin_add_domain('district.org')$$), 'non-admin cannot approve a domain');
select tests.ok(tests.throws($$select public.admin_approve_teacher(auth.uid())$$), 'non-admin cannot approve themselves');
select tests.ok(tests.throws($$select public.has_student_footprint(auth.uid())$$), 'helper is not callable by clients');
select tests.ok(public.my_teacher_request() ->> 'status' is null, 'no request yet');
commit;

-- ---------- the grant (as the Edge Function / service role would call it)
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e3', tests.ev('ver@other.edu', 'other.edu', true, 2)) ->> 'via' = 'verified_teacher',
  'Google-verified teacher with a course is a teacher immediately');
select tests.ok((select role from profiles where email = 'ver@other.edu') = 'teacher', '... and the role is set');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e3', tests.ev('someone@other.edu', 'other.edu', true, 2)) ->> 'reason' = 'wrong_account',
  'an existing teacher cannot claim with another account''s Classroom (would import their classes)');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e3', tests.ev('VER@other.edu', 'other.edu', false, 0)) ->> 'reason' = 'already_teacher',
  'an existing teacher re-claiming with their own account is a no-op grant');

select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', tests.ev('new.t@district.org', 'district.org', false, 2)) ->> 'reason' = 'not_verified',
  'school account, not verified, domain not approved: pending');
select tests.ok((select role from profiles where email = 'new.t@district.org') = 'student', '... and still a student');

select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e4', tests.ev('kid@gmail.com', null, false, 3)) ->> 'reason' = 'personal_account',
  'personal Gmail with self-made courses: pending, never automatic');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e4', tests.ev('kid@gmail.com', 'gmail.com', false, 3)) ->> 'reason' = 'personal_account',
  'a gmail.com "hosted domain" is still a personal account');

select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', tests.ev('ver@other.edu', 'other.edu', true, 2)) ->> 'reason' = 'wrong_account',
  'Classroom access from a different Google account is refused, even a verified teacher''s');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', tests.ev('new.t@district.org', 'district.org', true, 0)) ->> 'reason' = 'no_courses',
  'no active courses: refused');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', tests.ev('new.t@district.org', 'district.org', true, null) - 'active_courses' || '{"active_courses":"9"}') ->> 'reason' = 'no_courses',
  'a non-numeric course count counts as zero');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000b1', tests.ev('s1@district.org', 'district.org', true, 4)) ->> 'reason' = 'student_account',
  'an enrolled student is refused even if Google calls them a verified teacher');
select tests.ok((select role from profiles where email = 's1@district.org') = 'student', '... and stays a student');
select tests.ok(tests.throws($$select public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', '[]')$$), 'evidence must be an object');

-- trusted domain: flagged for the admin, never a grant
insert into teacher_domains (domain) values ('district.org');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', tests.ev('new.t@district.org', 'district.org', false, 2)) ->> 'reason' = 'trusted_domain',
  'trusted school domain, not verified by Google: pending (a student there could have made a throwaway class)');
select tests.ok((select role from profiles where email = 'new.t@district.org') = 'student', '... and still a student, with no access to answer keys');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', tests.ev('new.t@district.org', 'district.org', true, 2)) ->> 'via' = 'verified_teacher',
  'the same account once Google verifies them as a teacher: in');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e5', tests.ev('rost@district.org', 'district.org', false, 1)) ->> 'reason' = 'on_student_roster',
  'trusted domain and a Classroom roster lists them as a student: pending as a student-roster flag');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e6', tests.ev('x@evil.org', 'district.org', false, 1)) ->> 'status' = 'pending',
  'trust matches the email''s domain, not just the hosted domain');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e6', tests.ev('x@evil.org', 'evil.org', false, 1)) ->> 'reason' = 'not_verified',
  'their own Workspace domain is not an approved school: pending');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e7', tests.ev('pend@district2.org', 'district2.org', false, 1)) ->> 'status' = 'pending',
  'another pending sign-up');

-- evidence is bounded
select public.claim_teacher_for('00000000-0000-0000-0000-0000000000e7', jsonb_build_object('google_email', 'pend@district2.org',
  'hosted_domain', 'district2.org', 'active_courses', 99999999, 'students', 1e30,
  'course_names', (select jsonb_agg(repeat('x', 500)) from generate_series(1, 50)), 'junk', repeat('y', 10000)));
select tests.ok((select jsonb_array_length(evidence -> 'course_names') = 5 and length(evidence #>> '{course_names,0}') = 120
                    and not evidence ? 'junk' and (evidence ->> 'active_courses')::int = 1000
                 from teacher_requests where user_id = '00000000-0000-0000-0000-0000000000e7'),
  'stored evidence keeps 5 names of 120 chars, caps numbers, drops unknown keys');

-- ---------- the signer-up's own view
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000e4');
select tests.ok(public.my_teacher_request() ->> 'status' = 'pending' and public.my_teacher_request() ->> 'reason' = 'personal_account',
  'a pending user sees their status and why');
select tests.ok(public.classroom_status() is null, 'a pending user is not a teacher anywhere: classroom_status is teacher-only');
select tests.ok(not exists (select 1 from questions), 'a pending user cannot read any answer key');
commit;

-- ---------- admin decisions
insert into google_tokens (user_id, refresh_token_enc, scopes) values ('00000000-0000-0000-0000-0000000000e4', 'enc', 's');
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000e1');
create temp table d2 as select public.admin_dashboard() as j;
select tests.ok((select count(*) = 4 from d2, jsonb_array_elements(j -> 'signups') s), 'dashboard lists the 4 pending sign-ups');
select tests.ok((select s #>> '{evidence,course_names,0}' = 'Period 1' from d2, jsonb_array_elements(j -> 'signups') s where s ->> 'email' = 'kid@gmail.com'),
  'sign-up shows what Google said (course names)');
select tests.ok((select r ->> 'via' = 'verified_teacher' from d2, jsonb_array_elements(j -> 'teachers') r where r ->> 'email' = 'new.t@district.org'),
  'teacher list says how they got in');
select tests.ok((select r ->> 'via' = 'verified_teacher' from d2, jsonb_array_elements(j -> 'teachers') r where r ->> 'email' = 'ver@other.edu'),
  'verified teachers are labelled');

select tests.ok(tests.throws($$select public.admin_add_domain('gmail.com')$$), 'gmail.com cannot be approved as a school');
select tests.ok(tests.throws($$select public.admin_add_domain('not a domain')$$), 'junk domain rejected');
select tests.ok(public.admin_add_domain('@District2.org ') ->> 'domain' = 'district2.org', 'domain is normalized');
select tests.ok(public.admin_remove_domain('district2.org') ->> 'domain' = 'district2.org', 'domain removed');

select tests.ok(public.admin_deny_teacher('00000000-0000-0000-0000-0000000000e4') ->> 'email' = 'kid@gmail.com', 'admin denies the Gmail sign-up');
select tests.ok(tests.throws($$select public.admin_deny_teacher('00000000-0000-0000-0000-0000000000e4')$$), 'cannot deny twice');
select tests.ok(public.admin_approve_teacher('00000000-0000-0000-0000-0000000000e6') ->> 'email' = 'x@evil.org', 'admin approves a pending sign-up');
select tests.ok(tests.throws($$select public.admin_approve_teacher('00000000-0000-0000-0000-0000000000b1')$$), 'cannot approve someone with no pending sign-up');
select tests.ok(public.admin_remove_teacher('new.t@district.org') ->> 'demoted' = 'true', 'admin removes a teacher');
commit;

select tests.ok((select role from profiles where email = 'x@evil.org') = 'teacher', 'approved sign-up is a teacher');
select tests.ok(not exists (select 1 from google_tokens where user_id = '00000000-0000-0000-0000-0000000000e4'), 'deny drops their stored Classroom token');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e4', tests.ev('kid@gmail.com', null, true, 3)) ->> 'reason' = 'blocked',
  'a denied account cannot sign up again');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e2', tests.ev('new.t@district.org', 'district.org', true, 2)) ->> 'reason' = 'removed',
  'a removed teacher cannot walk back in, even as a Google-verified teacher, and is told they were removed');
select tests.ok((select role from profiles where email = 'new.t@district.org') = 'student', '... and stays a student');

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000e4');
select tests.ok((public.my_teacher_request() ->> 'blocked')::boolean, 'a blocked user is told so');
select tests.ok(not (public.my_teacher_request() ->> 'removed')::boolean, '... as a denied sign-up, not a removed teacher');
select tests.become('00000000-0000-0000-0000-0000000000e2');
select tests.ok((public.my_teacher_request() ->> 'removed')::boolean and public.my_teacher_request() ->> 'status' is null,
  'a removed teacher sees "removed", not a pending sign-up');
select tests.become('00000000-0000-0000-0000-0000000000e1');
select tests.ok(public.admin_unblock_teacher('KID@gmail.com') ->> 'email' = 'kid@gmail.com', 'admin can unblock');
select tests.ok(public.admin_add_teacher('new.t@district.org') ->> 'promoted' = 'true', 'pre-approving a removed teacher unblocks and restores them');
select tests.ok((select count(*) = 7 from jsonb_array_elements(public.admin_dashboard() -> 'audit') a
                 where a ->> 'action' in ('add_domain', 'remove_domain', 'deny_teacher', 'approve_teacher', 'remove_teacher', 'unblock_teacher', 'add_teacher')
                   and a ->> 'actor' = 'boss2@oasis.dev'),
  'every decision is audited');
commit;
select tests.ok(not exists (select 1 from teacher_blocks where email in ('kid@gmail.com', 'new.t@district.org')), 'blocks lifted');
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e4', tests.ev('kid@gmail.com', null, false, 3)) ->> 'status' = 'pending',
  'unblocked Gmail goes back to pending, not straight in');

-- verified overrides a roster listing (Google's admin attested it)
select tests.ok(public.claim_teacher_for('00000000-0000-0000-0000-0000000000e5', tests.ev('rost@district.org', 'district.org', true, 1)) ->> 'via' = 'verified_teacher',
  'a Google-verified teacher on a roster (e.g. a PD course) still gets in');

-- cleanup
delete from admin_audit;
delete from teacher_blocks; delete from teacher_domains; delete from teacher_requests;
delete from teacher_allowlist where email = 'new.t@district.org';
delete from roster_entries where email = 'rost@district.org';
delete from admins where email = 'boss2@oasis.dev';
delete from profiles where id::text like '00000000-0000-0000-0000-0000000000e_';
delete from auth.users where id::text like '00000000-0000-0000-0000-0000000000e_';
drop function tests.ev(text, text, boolean, int);
\echo 'ALL TEACHER SIGNUP TESTS PASSED'
