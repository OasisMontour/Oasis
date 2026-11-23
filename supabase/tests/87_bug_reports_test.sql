-- Bug reports: signed-in only, rate limited, auto-ranked, admin triage, changelog shows only fix notes.
\set ON_ERROR_STOP on
\set QUIET on

select tests.ok((select severity from public.rank_bug('I can see another student''s answers', '/student', 'student')) = 'high', 'privacy issue ranks high');
select tests.ok((select severity from public.rank_bug('my progress reset and I had to start over', '/student', 'student')) = 'high', 'lost progress ranks high');
select tests.ok((select severity from public.rank_bug('Can''t submit my answer', '/student/assignments/x', 'student')) = 'high', 'cannot submit ranks high');
select tests.ok((select severity from public.rank_bug('the video is really slow', '/student', 'student')) = 'medium', 'slow video ranks medium');
select tests.ok((select severity from public.rank_bug('typo on the home page: recieve', '/student', 'student')) = 'low', 'typo ranks low');
select tests.ok((select severity from public.rank_bug('typo on the home page: recieve', '/student/assignments/a', 'student')) = 'medium', 'anything from the lesson player is at least medium');
select tests.ok((select severity from public.rank_bug('the colors are ugly', '/teacher', 'teacher')) = 'medium', 'teacher reports are at least medium');

insert into auth.users (id, email, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000c9', 'bug.admin@oasis.dev', '{"provider":"google"}');
insert into admins (email) values ('bug.admin@oasis.dev');

begin;
set local role anon;
select tests.ok(tests.throws($$select public.submit_bug_report('anon spam spam spam')$$), 'signed-out users cannot report');
rollback;

begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok((public.submit_bug_report('My progress was lost after the wifi dropped', '/student/assignments/123', 'UA') ->> 'severity') = 'high', 'student reports a bug, ranked high');
select tests.ok(tests.throws($$select public.submit_bug_report('hi')$$), 'too-short report rejected');
select tests.ok(tests.throws($$select public.submit_bug_report(repeat('a', 2001))$$), 'too-long report rejected');
select public.submit_bug_report('report number ' || i) from generate_series(2, 5) i;
select tests.ok(tests.throws($$select public.submit_bug_report('report number 6')$$), 'sixth report in an hour is rate limited');
select tests.ok(jsonb_array_length(public.my_bug_reports()) = 5, 'reporter sees their own reports');
select tests.ok(tests.throws('select * from bug_reports'), 'clients cannot read the table');
select tests.ok(tests.throws($$update bug_reports set status = 'fixed'$$), 'clients cannot write the table');
select tests.ok(tests.throws('select public.admin_bug_reports()'), 'student cannot list all reports');
select tests.ok(tests.throws($$select public.admin_update_bug(1, 'low', 'fixed', 'x')$$), 'student cannot triage');
select tests.ok(tests.throws($$select public.rank_bug('x', '', 'student')$$), 'rank_bug is not exposed');

select tests.become('00000000-0000-0000-0000-0000000000b2');
select tests.ok(jsonb_array_length(public.my_bug_reports()) = 0, 'other users cannot see someone else''s reports');

select tests.become('00000000-0000-0000-0000-0000000000a1');
select public.submit_bug_report('The colors on the results page are hard to read', '/teacher/assignments/A1', 'UA');

select tests.become('00000000-0000-0000-0000-0000000000c9');
create temp table b as select public.admin_bug_reports() as j;
select tests.ok((select jsonb_array_length(j) = 6 from b), 'admin sees all reports');
select tests.ok((select j -> 0 ->> 'severity' = 'high' from b), 'open high-severity reports come first');
select tests.ok((select bool_and(r ->> 'reporter' is null) from b, jsonb_array_elements(j) r where r ->> 'reporter_role' = 'student'), 'student reporters stay anonymous to admins');
select tests.ok((select bool_and(r ->> 'reporter' = 't1@district.org') from b, jsonb_array_elements(j) r where r ->> 'reporter_role' = 'teacher'), 'teacher reporters are named');
select tests.ok(tests.throws($$select public.admin_update_bug((select (j -> 0 ->> 'id')::bigint from b), 'high', 'fixed', '')$$), 'cannot mark fixed without a note');
select public.admin_update_bug((select (j -> 0 ->> 'id')::bigint from b), 'high', 'fixed', 'Progress now saves even when Wi-Fi drops');
select tests.ok(tests.throws($$select public.admin_update_bug(1, 'urgent', 'open', '')$$), 'invalid severity rejected');

select tests.become('00000000-0000-0000-0000-0000000000b2');
select tests.ok(jsonb_array_length(public.changelog()) = 1, 'changelog lists the fix');
select tests.ok(public.changelog() -> 0 ->> 'note' = 'Progress now saves even when Wi-Fi drops', 'changelog shows the fix note');
select tests.ok(position('wifi dropped' in public.changelog()::text) = 0, 'changelog never shows the original report text');
select tests.become('00000000-0000-0000-0000-0000000000b1');
select tests.ok((select r ->> 'status' from jsonb_array_elements(public.my_bug_reports()) r where r ->> 'description' like 'My progress%') = 'fixed', 'reporter sees their report was fixed');
commit;

drop table b;
delete from bug_reports;
delete from admins where email = 'bug.admin@oasis.dev';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000c9';
delete from profiles where id = '00000000-0000-0000-0000-0000000000c9';
\echo 'ALL BUG REPORT TESTS PASSED'
