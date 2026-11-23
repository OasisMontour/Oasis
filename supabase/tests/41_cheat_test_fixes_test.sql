-- Cheat-test regressions (Nov 23, server side). See migration 20261125000100.
\set ON_ERROR_STOP on
\set QUIET on

insert into lessons (id, teacher_id, title, youtube_id, duration_s)
  values ('20000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-0000000000a1', 'Cheat', 'cheatcheatc', 600);
insert into assignments (id, lesson_id, class_id)
  values ('40000000-0000-0000-0000-000000000041', '20000000-0000-0000-0000-000000000041', '10000000-0000-0000-0000-000000000001');
create temp table pre_enrolled as select * from enrollments;
insert into enrollments (class_id, student_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1') on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select (get_student_lesson('40000000-0000-0000-0000-000000000041') ->> 'attempt_id') as att \gset

-- a new attempt has no banked credit: a script can't jump 30s before the video has even started
select tests.ok(tests.throws(format('select save_progress(%L, 20, 20)', :'att')), 'new attempt starts with an empty bucket');
reset role;

-- credit is measured with the real clock after the row lock, not the transaction start time
-- (parallel saves used to re-credit the same seconds by writing an older credit_at)
update attempts set watch_credit_s = 0, credit_at = now() where id = :'att';
begin;
set local role authenticated;
select tests.become('00000000-0000-0000-0000-0000000000b1');
select save_progress(:'att', 0, 0);
select pg_sleep(1.3);
select tests.ok(not tests.throws(format('select save_progress(%L, 1, 1)', :'att')), 'credit uses clock time, not transaction start');
commit;

update attempts set credit_at = now() + interval '1 hour' where id = :'att';
select credit_at as future from attempts where id = :'att' \gset
set role authenticated;
select save_progress(:'att', 1, 1);
reset role;
select tests.ok((select credit_at from attempts where id = :'att') >= :'future'::timestamptz, 'credit_at never moves backwards');

-- numbers
update attempts set credit_at = now() - interval '1 hour' where id = :'att';
set role authenticated;
select tests.ok(tests.throws(format($$select save_progress(%L, 'Infinity', 1)$$, :'att')), 'infinite progress rejected');
select tests.ok(tests.throws(format($$select save_progress(%L, 2, '-Infinity')$$, :'att')), 'infinite position rejected');
select save_progress(:'att', 2.123456789012345678901234567890, 2.1);
reset role;
select tests.ok((select scale(max_watched_s) from attempts where id = :'att') <= 3, 'progress is stored to the millisecond, not 16k decimals');

-- focus log: no_fullscreen_support can't fill the cap and hide real exits
set role authenticated;
select count(*) from (select log_focus_event(:'att', 'no_fullscreen_support', 1) from generate_series(1, 600)) x;
select log_focus_event(:'att', 'tab_hidden', 5);
select tests.ok(tests.throws(format($$select log_focus_event(%L, 'blur', 'NaN')$$, :'att')), 'NaN position rejected');
select log_focus_event(:'att', 'blur', 1e300);
reset role;
select tests.ok((select count(*) from focus_events where attempt_id = :'att' and kind = 'no_fullscreen_support') = 1, 'no_fullscreen_support logged once');
select tests.ok((select count(*) from focus_events where attempt_id = :'att' and kind = 'tab_hidden') = 1, 'real exit still logged after a flood');
select tests.ok((select max(video_s) from focus_events where attempt_id = :'att') <= 600, 'positions clamped to the video');

-- a teacher can't shrink a started lesson so students finish early; lengthening is fine
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select tests.ok(tests.throws($$select save_lesson('{"id":"20000000-0000-0000-0000-000000000041","title":"Cheat","youtube_id":"cheatcheatc","duration_s":121}', '[]')$$),
  'cannot shorten a lesson students started');
select tests.ok(not tests.throws($$select save_lesson('{"id":"20000000-0000-0000-0000-000000000041","title":"Cheat","youtube_id":"cheatcheatc","duration_s":601}', '[]')$$),
  'can lengthen it');
reset role;

-- finished attempts log nothing
update attempts set finished_at = now() where id = :'att';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select log_focus_event(:'att', 'blur', 3);
reset role;
select tests.ok((select count(*) from focus_events where attempt_id = :'att' and kind = 'blur') = 1, 'no events after finishing');

-- leave the shared fixtures as they were
delete from lessons where id = '20000000-0000-0000-0000-000000000041';
delete from enrollments e where not exists (select 1 from pre_enrolled p where p.class_id = e.class_id and p.student_id = e.student_id);
\echo 'ALL CHEAT TEST FIX TESTS PASSED'
